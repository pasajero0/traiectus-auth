import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../db/client'
import { loadEnv } from '../env'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'

const CLIENT_SECRET = 'a-client-secret-long-enough-to-pass'

/**
 * Nothing here reaches the database: every request below is refused or counted before the
 * handler runs, and postgres-js connects lazily.
 */
const testEnv = () =>
  loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    INTERNAL_API_KEY: 'test-internal-key',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    CLIENTS: JSON.stringify([
      {
        id: 'harbor',
        secret: CLIENT_SECRET,
        redirectUris: ['http://localhost:3000/api/auth/callback'],
        name: 'Harbor',
        homeUrl: 'http://localhost:3000',
      },
    ]),
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

const basic = (id: string, secret = CLIENT_SECRET) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`

beforeEach(() => {
  resetRouteTable()
})

afterEach(async () => {
  await teardown()
})

/**
 * ADR-0023: keyed by the client, not the address — every request from one product arrives
 * from that product's own server, so an address key would be one bucket for all its users.
 */
describe('the rate limit on /v1/token', () => {
  it('counts each client separately, however many addresses it calls from', async () => {
    const app = await assemble()
    const hit = (id: string, remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/token',
        headers: { authorization: basic(id) },
        remoteAddress,
        payload: {},
      })

    // Sixty from one client, deliberately from a different address every time.
    for (let i = 0; i < 60; i += 1) await hit('harbor', `10.0.0.${i}`)

    expect((await hit('harbor', '10.0.1.1')).statusCode).toBe(429)
    expect((await hit('beacon', '10.0.0.1')).statusCode).not.toBe(429)
  })

  /** A wrong secret is refused for its own reason, but the attempt is still counted. */
  it('spends that bucket even when the secret is wrong', async () => {
    const app = await assemble()
    const hit = () =>
      app.inject({
        method: 'POST',
        url: '/v1/token',
        headers: { authorization: basic('harbor', 'not-the-secret') },
        payload: {},
      })

    for (let i = 0; i < 60; i += 1) await hit()

    expect((await hit()).statusCode).toBe(429)
  })
})
