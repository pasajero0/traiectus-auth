import { Hono } from 'hono'

import type { Env } from '../env.js'

/**
 * The door. Parse, authenticate, delegate, serialise — and nothing else.
 * Anything that grows here becomes invisible to callers arriving by another
 * door, which in v2 means the mobile client. See ADR-0005.
 */
export function messagesRoutes(_env: Env): Hono {
  const routes = new Hono()

  routes.get('/', async (c) => {
    // Day 6: requirePrincipal(c.req.raw) from @traiectus/auth-client/resource
    // verifies the bearer token's signature locally against ACCESS_TOKEN_PUBLIC_KEY.
    return c.json({ error: 'not_implemented' }, 501)
  })

  return routes
}
