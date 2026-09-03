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
 * The limiter sits ahead of the auth guard (`onRequest`, before the internal-key
 * `preHandler`), so a request that will fail for its own reason still spends its share of
 * the bucket — proof the CPU cap holds regardless of who is asking or whether they are
 * right to ask.
 */
describe('the rate limit on /v1/credentials/verify', () => {
  it('answers 429 once the bucket for this route is spent, and no other route shares it', async () => {
    const app = await assemble()
    const hit = () => app.inject({ method: 'POST', url: '/v1/credentials/verify' })

    let last: Awaited<ReturnType<typeof hit>> | undefined
    for (let i = 0; i < 10; i += 1) last = await hit()
    expect(last?.statusCode).not.toBe(429)

    expect((await hit()).statusCode).toBe(429)

    const other = await app.inject({ method: 'POST', url: '/v1/sessions/verify' })
    expect(other.statusCode).not.toBe(429)
  })

  /** ADR-0021: a fixed key, not `request.ip` — two addresses must share one bucket. */
  it('is one bucket for the whole service, not one per address', async () => {
    const app = await assemble()
    const hit = (remoteAddress: string) =>
      app.inject({ method: 'POST', url: '/v1/credentials/verify', remoteAddress })

    for (let i = 0; i < 5; i += 1) await hit('10.0.0.1')
    for (let i = 0; i < 5; i += 1) await hit('10.0.0.2')

    expect((await hit('10.0.0.1')).statusCode).toBe(429)
    expect((await hit('10.0.0.3')).statusCode).toBe(429)
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
