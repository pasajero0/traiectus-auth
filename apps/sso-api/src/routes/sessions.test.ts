import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../db/client'
import { hashSessionToken, mintSessionToken } from '../domain/session'
import { loadEnv } from '../env'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'

const INTERNAL_KEY = 'test-internal-key'

/**
 * Nothing here reaches the database: every request below is refused by the audience guard
 * or by validation, and postgres-js connects lazily. The two windows live in SQL and are
 * checked by hand until fixtures land — 07/09.
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

const routes = [
  { method: 'POST' as const, url: '/v1/sessions', malformed: { userId: 'not-a-uuid' } },
  { method: 'POST' as const, url: '/v1/sessions/verify', malformed: { token: '' } },
  { method: 'DELETE' as const, url: '/v1/sessions', malformed: {} },
]

beforeEach(() => {
  resetRouteTable()
})

afterEach(async () => {
  await teardown()
})

describe.each(routes)('$method $url', ({ method, url, malformed }) => {
  it('refuses a caller without the internal key', async () => {
    const app = await assemble()

    const response = await app.inject({ method, url, payload: { token: 'anything' } })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('answers 400 to a malformed body', async () => {
    const app = await assemble()

    const response = await app.inject({ method, url, headers: withKey, payload: malformed })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid_request' })
  })
})

describe('the session token', () => {
  it('is 256 bits, and no two are alike', () => {
    const first = mintSessionToken()

    // 32 bytes in base64url, unpadded.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(mintSessionToken())
  })

  it('is not recoverable from what is stored', () => {
    const token = mintSessionToken()
    const stored = hashSessionToken(token)

    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(token)
  })

  it('hashes the same token to the same row every time', () => {
    const token = mintSessionToken()

    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })
})
