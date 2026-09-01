import { Hono } from 'hono'

import type { Env } from './env'
import { messagesRoutes } from './routes/messages'

/**
 * Builds the app without listening, so tests can drive it through `app.request()`.
 *
 * No browser reaches this service. Its only caller is beacon-web's server, which
 * unseals the session cookie and attaches the bearer itself (ADR-0008), and in v2
 * the mobile client, which carries a token from the device keychain. Both are
 * server-side or native callers, so there is no origin to permit and no CORS
 * here at all — ADR-0001. It holds no session and sets no cookie, so the CSRF
 * surface lives on beacon-web, not here.
 */
export function buildApp(env: Env): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok', service: 'beacon-api' }))
  app.route('/v1/messages', messagesRoutes(env))

  return app
}
