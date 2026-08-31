import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { Env } from './env'
import { messagesRoutes } from './routes/messages'

/**
 * Builds the app without listening, so tests can drive it through `app.request()`.
 *
 * This service holds no session and sets no cookie: every caller arrives with a
 * bearer token, browser and mobile alike. That is also why it has no CSRF surface.
 */
export function buildApp(env: Env): Hono {
  const app = new Hono()

  app.use(
    '/v1/*',
    cors({
      origin: env.ALLOWED_ORIGIN,
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST'],
    }),
  )

  app.get('/health', (c) => c.json({ status: 'ok', service: 'beacon-api' }))
  app.route('/v1/messages', messagesRoutes(env))

  return app
}
