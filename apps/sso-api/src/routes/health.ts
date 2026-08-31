import type { FastifyInstance } from 'fastify'
import type { Env } from '../env'

const startedAt = Date.now()

/**
 * Liveness probe. Deliberately says nothing about users, sessions, or configuration:
 * it is the one endpoint reachable without credentials.
 */
export function healthRoutes(env: Env) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/health', async () => ({
      status: 'ok',
      service: 'traiectus-auth',
      commit: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    }))
  }
}
