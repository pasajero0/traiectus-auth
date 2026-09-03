import { Hono } from 'hono'
import { requirePrincipal, type Principal } from '@traiectus/auth-client/resource'

import type { Env } from './env.js'

/**
 * A route cannot be registered without naming its audience — ADR-0007. Only one exists
 * here: this product has no route open to the world besides `/health`.
 */

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal
  }
}

/** This product's own audience. In code, not configuration. */
const AUDIENCE = 'beacon'

/** A verified access token, or 401. The principal is set for every handler behind it. */
export function principalRouter(env: Env): Hono {
  const router = new Hono()

  router.use('*', async (c, next) => {
    const result = await requirePrincipal(
      { issuer: env.ISSUER, audience: AUDIENCE, publicKey: env.ACCESS_TOKEN_PUBLIC_KEY },
      c.req.header('authorization'),
    )

    if (!result.verified) return c.json({ error: 'unauthorized' }, 401)

    c.set('principal', result.principal)
    await next()
  })

  return router
}
