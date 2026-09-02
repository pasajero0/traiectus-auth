import { beforeEach, describe, expect, it } from 'vitest'

import { loadEnv } from './env'
import { buildServer } from './server'
import { declaredRoutes, registeredRoutes, resetRouteTable } from './routing'

/** Enough environment to build the server. No database is opened here. */
const env = () =>
  loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    INTERNAL_API_KEY: 'test-key',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  } as NodeJS.ProcessEnv)

/**
 * The guard ADR-0007 asks for: it walks the assembled application rather than the
 * source, so it covers routes nobody has written yet. A route mounted straight onto
 * a Fastify instance never reaches the declared table, and this fails.
 */
describe('the route table', () => {
  beforeEach(() => {
    resetRouteTable()
  })

  it('has every mounted route arrive through an audience router', async () => {
    const app = await buildServer(env())
    await app.ready()

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
    await app.close()
  })

  it('names an audience for every declared route', async () => {
    const app = await buildServer(env())
    await app.ready()

    expect(declaredRoutes().length).toBeGreaterThan(0)
    for (const route of declaredRoutes()) {
      expect(['public', 'internal']).toContain(route.audience)
    }
    await app.close()
  })
})
