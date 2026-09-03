import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from './db/client'
import { loadEnv } from './env'
import { declaredRoutes, registeredRoutes, resetRouteTable } from './routing'
import { buildServer } from './server'

const INTERNAL_KEY = 'test-internal-key'

/**
 * Enough environment to assemble the server. postgres-js connects lazily, so no
 * database is opened unless a test actually runs a query — none here does.
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

beforeEach(() => {
  resetRouteTable()
})

afterEach(async () => {
  await teardown()
})

/**
 * The guard ADR-0007 asks for. It walks the assembled application rather than the
 * source, so it also covers routes nobody has written yet: a route mounted straight
 * onto a Fastify instance never reaches the declared table, and this fails.
 */
describe('the route table', () => {
  it('has every mounted route arrive through an audience router', async () => {
    await assemble()

    const declared = new Set(declaredRoutes().map((r) => `${r.method} ${r.url}`))

    // Fastify mounts a HEAD for every GET. It is the same route with the same
    // audience, so it is normalised onto its GET rather than exempted — an
    // exemption is a hole.
    const mounted = registeredRoutes().map(({ method, url }) =>
      method === 'HEAD' ? `GET ${url}` : `${method} ${url}`,
    )

    // Deduplicated: a GET and its generated HEAD normalise to the same entry, and
    // naming the same path twice makes the failure harder to read, not clearer.
    const undeclared = [...new Set(mounted.filter((route) => !declared.has(route)))]

    expect(undeclared, 'routes mounted without naming an audience').toEqual([])
  })

  it('names an audience for every declared route', async () => {
    await assemble()

    expect(declaredRoutes().length).toBeGreaterThan(0)
    for (const route of declaredRoutes()) {
      expect(['public', 'internal', 'client']).toContain(route.audience)
    }
  })
})

/**
 * The internal audience refuses before any handler runs, so these never reach the
 * database. A missing key and a wrong one are answered identically — the difference
 * is not something a caller is entitled to learn.
 */
describe('an internal route', () => {
  const body = { email: 'someone@example.com', password: 'correct horse battery' }

  it('refuses a request carrying no key', async () => {
    const app = await assemble()

    const response = await app.inject({ method: 'POST', url: '/v1/users', payload: body })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('refuses a wrong key, and says no more than it does for a missing one', async () => {
    const app = await assemble()

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { 'x-traiectus-internal-key': 'not-the-key' },
      payload: body,
    })
    const missing = await app.inject({ method: 'POST', url: '/v1/users', payload: body })

    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual(missing.json())
  })

  it('leaves a public route reachable without a key', async () => {
    const app = await assemble()

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
  })
})
