import { verifyCredentialsRequestSchema } from '@traiectus/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../db/client'
import { loadEnv } from '../env'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'

const INTERNAL_KEY = 'test-internal-key'

/**
 * Nothing here reaches the database: every request below is refused by the audience guard
 * or by validation, and postgres-js connects lazily. A real password is checked by hand
 * until fixtures land — 07/09.
 */
const testEnv = () =>
  loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    INTERNAL_API_KEY: INTERNAL_KEY,
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  } as NodeJS.ProcessEnv)

let teardown: () => Promise<unknown> = async () => undefined

async function assemble() {
  const env = testEnv()
  const { db, close } = createDatabase(env)
  const app = await buildServer(env, db)
  await app.ready()
  teardown = async () => {
    await app.close()
    await close()
  }
  return app
}

const withKey = { 'x-traiectus-internal-key': INTERNAL_KEY }

beforeEach(() => {
  resetRouteTable()
})

afterEach(async () => {
  await teardown()
})

describe('POST /v1/credentials/verify', () => {
  it('refuses a caller without the internal key', async () => {
    const app = await assemble()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/credentials/verify',
      payload: { email: 'someone@example.com', password: 'correct horse battery' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('answers 400 to a body that is missing the password', async () => {
    const app = await assemble()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/credentials/verify',
      headers: withKey,
      payload: { email: 'someone@example.com' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })

  it('answers 400 to a body that is not an object', async () => {
    const app = await assemble()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/credentials/verify',
      // Valid JSON, so the body parser accepts it and the schema is what rejects it. A
      // parser error would be a different 400 and would prove nothing about the route.
      headers: { ...withKey, 'content-type': 'application/json' },
      payload: '"someone@example.com"',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

/**
 * Two counters guard this route, and they are deliberately different in kind. The address
 * one below is the coarse net; the counter that matters — failures against one account,
 * whatever address they arrive from — needs a real database to reach a failed check, so it
 * lives in `credentials.db.test.ts`.
 *
 * The address limiter sits ahead of the auth guard (`onRequest`, before the internal-key
 * `preHandler`), so a request that will fail for its own reason still spends its share.
 */
describe('the address limit on /v1/credentials/verify', () => {
  const SPEND = 30

  it('answers 429 once the bucket for this route is spent, and no other route shares it', async () => {
    const app = await assemble()
    const hit = () => app.inject({ method: 'POST', url: '/v1/credentials/verify' })

    let last: Awaited<ReturnType<typeof hit>> | undefined
    for (let i = 0; i < SPEND; i += 1) last = await hit()
    expect(last?.statusCode).not.toBe(429)

    expect((await hit()).statusCode).toBe(429)

    const other = await app.inject({ method: 'POST', url: '/v1/sessions/verify' })
    expect(other.statusCode).not.toBe(429)
  })

  /**
   * ADR-0023, superseding ADR-0021's single bucket: sso-web forwards which browser is
   * asking, so one address flooding this route no longer spends everyone else's budget.
   */
  it('gives each forwarded browser its own bucket', async () => {
    const app = await assemble()
    // Deliberately missing the password: the schema refuses it before the handler can
    // reach a database this job does not have, while the limiter — which counts on
    // `onRequest` — has already spent the bucket. A "realistic" payload here passes
    // locally, where Postgres happens to listen, and hangs in CI, where it does not.
    const hit = (address: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/credentials/verify',
        headers: { ...withKey, 'x-traiectus-client-ip': address },
        payload: { email: 'someone@example.com' },
      })

    for (let i = 0; i < SPEND; i += 1) await hit('203.0.113.1')

    expect((await hit('203.0.113.1')).statusCode).toBe(429)
    expect((await hit('203.0.113.2')).statusCode).not.toBe(429)
  })

  /** Forgeable by anyone, so it counts for nothing without the key that vouches for it. */
  it('ignores a forwarded address from a caller that has no internal key', async () => {
    const app = await assemble()
    const hit = (address: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/credentials/verify',
        headers: { 'x-traiectus-client-ip': address },
        remoteAddress: '10.0.0.9',
      })

    // Many different claimed addresses, one real connection: the connection is what counts.
    for (let i = 0; i < SPEND; i += 1) await hit(`203.0.113.${i}`)

    expect((await hit('203.0.113.200')).statusCode).toBe(429)
  })
})

/** The difference from registration looks like an oversight, so it is pinned here. */
describe('the verification request schema', () => {
  it('accepts a password too short to register, because that is a wrong password', () => {
    const parsed = verifyCredentialsRequestSchema.safeParse({
      email: 'someone@example.com',
      password: 'short',
    })

    expect(parsed.success).toBe(true)
  })

  it('trims and lower-cases the address, so the lookup matches what was stored', () => {
    const parsed = verifyCredentialsRequestSchema.safeParse({
      email: '  Someone@Example.COM  ',
      password: 'correct horse battery',
    })

    expect(parsed.success && parsed.data.email).toBe('someone@example.com')
  })

  it('rejects a password long enough to be a way of spending memory', () => {
    const parsed = verifyCredentialsRequestSchema.safeParse({
      email: 'someone@example.com',
      password: 'x'.repeat(257),
    })

    expect(parsed.success).toBe(false)
  })
})
