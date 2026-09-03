import type { Hono } from 'hono'

import type { Env } from '../env.js'
import { listMessages } from '../domain/messages.js'
import { principalRouter } from '../routing.js'

/**
 * The door. Parse, authenticate, delegate, serialise — and nothing else.
 * Anything that grows here becomes invisible to callers arriving by another
 * door, which in v2 means the mobile client. See ADR-0005.
 */
export function messagesRoutes(env: Env): Hono {
  const routes = principalRouter(env)

  routes.get('/', (c) => c.json({ messages: listMessages(c.get('principal').userId) }))

  return routes
}
