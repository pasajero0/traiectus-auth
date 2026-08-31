import Fastify, { type FastifyInstance } from 'fastify'

import type { Env } from './env'
import { healthRoutes } from './routes/health'

/**
 * Builds the server without starting it, so tests can drive it through
 * `app.inject()` without binding a port.
 */
export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: env.NODE_ENV === 'production',
    disableRequestLogging: false,
  })

  await app.register(healthRoutes(env))

  return app
}
