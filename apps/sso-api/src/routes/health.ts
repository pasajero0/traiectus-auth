import type { Env } from '../env'
import { publicRouter } from '../routing'

const startedAt = Date.now()

/**
 * Liveness probe. Deliberately says nothing about users, sessions or configuration:
 * it is the one endpoint reachable without credentials, and publicRouter() is how
 * that is stated rather than assumed.
 */
export function healthRoutes(env: Env) {
  return publicRouter().get('/health', async () => ({
    status: 'ok',
    service: 'traiectus-auth',
    commit: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  })).plugin
}
