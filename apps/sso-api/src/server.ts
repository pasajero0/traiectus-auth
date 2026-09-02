import Fastify, { type FastifyInstance } from 'fastify'

import type { Env } from './env'
import { healthRoutes } from './routes/health'
import { recordRoutes } from './routing'

/**
 * Builds the server without starting it, so tests can drive it through
 * `app.inject()` without binding a port.
 */
export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-traiectus-internal-key"]',
      ],
    },
    trustProxy: env.NODE_ENV === 'production',
  })

  // Before any route, so the table is complete — see ADR-0007.
  recordRoutes(app)

  await app.register(healthRoutes(env))

  return app
}
