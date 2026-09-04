import formbody from '@fastify/formbody'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import type { Database } from './db/client'
import type { Env } from './env'
import { authorizationCodeRoutes } from './routes/authorization-codes'
import { clientRoutes } from './routes/clients'
import { credentialRoutes, SIGN_IN_FAILURE_LIMIT } from './routes/credentials'
import { healthRoutes } from './routes/health'
import { sessionRoutes } from './routes/sessions'
import { tokenRoutes } from './routes/token'
import { userRoutes } from './routes/users'
import { recordRoutes } from './routing'
import { maybeSweep } from './sweeper'

/**
 * Builds the server without starting it, so tests can drive it through
 * `app.inject()` without binding a port.
 */
export async function buildServer(env: Env, db: Database): Promise<FastifyInstance> {
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

  // ADR-0015: an ordinary response is what starts a sweep; nothing here awaits it.
  app.addHook('onResponse', async (request) => {
    maybeSweep(db, request.log)
  })

  // RFC 6749 §4.1.3 sends the token endpoint a form, not JSON. Fastify parses JSON on its
  // own and forms only with this, so registering it is what makes the endpoint standard.
  await app.register(formbody)

  // `global: false`: opt in per route via `config.rateLimit`, so a route that says nothing
  // about it stays unlimited rather than inheriting a default meant for one endpoint.
  await app.register(rateLimit, { global: false })

  // The per-caller limits below bound one visitor; this bounds the service. argon2id is
  // the only expensive thing sso-api does, and an attacker who rotates addresses walks
  // straight through a per-address cap — so the two routes that hash share one budget,
  // keyed by nothing at all. ADR-0023.
  const hashBudget = app.createRateLimit({
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: () => 'argon2id',
  })

  // The counter NIST SP 800-63B asks for: failures against one account, whatever address
  // they arrive from. Its shape belongs to the route that understands the body it reads.
  const signInFailures = app.createRateLimit(SIGN_IN_FAILURE_LIMIT)

  await app.register(healthRoutes(env))
  await app.register(userRoutes(env, db, hashBudget))
  await app.register(credentialRoutes(env, db, hashBudget, signInFailures))
  await app.register(sessionRoutes(env, db))
  await app.register(authorizationCodeRoutes(env, db))
  await app.register(clientRoutes(env))
  await app.register(tokenRoutes(env, db))

  return app
}
