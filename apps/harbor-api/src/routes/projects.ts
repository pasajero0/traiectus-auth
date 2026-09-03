import type { Hono } from 'hono'

import type { Env } from '../env.js'
import { listProjects } from '../domain/projects.js'
import { principalRouter } from '../routing.js'

/**
 * The door. Parse, authenticate, delegate, serialise — and nothing else.
 * Anything that grows here becomes invisible to callers arriving by another
 * door, which in v2 means the mobile client. See ADR-0005.
 */
export function projectsRoutes(env: Env): Hono {
  const routes = principalRouter(env)

  routes.get('/', (c) => c.json({ projects: listProjects(c.get('principal').userId) }))

  return routes
}
