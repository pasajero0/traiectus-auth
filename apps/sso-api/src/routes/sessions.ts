import { createSessionRequestSchema, sessionTokenRequestSchema } from '@traiectus/contracts'

import type { Database } from '../db/client'
import { openSession, revokeSession, verifySession } from '../domain/session'
import type { Env } from '../env'
import { internalRouter } from '../routing'

const invalidRequest = { error: 'invalid_request' } as const
const internalError = { error: 'internal_error' } as const

/**
 * The SSO session, opened and read only by sso-web over the shared secret — ADR-0004.
 * Whoever holds that key can open a session for any user; that is what the key is, and
 * why it lives in the deployment platform and nowhere else.
 */
export function sessionRoutes(env: Env, db: Database) {
  return internalRouter(env)
    .post('/v1/sessions', async (request, reply) => {
      const parsed = createSessionRequestSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(invalidRequest)

      try {
        const { token, expiresAt } = await openSession(db, parsed.data.userId)
        return reply.code(201).send({ token, expiresAt: expiresAt.toISOString() })
      } catch (error) {
        request.log.error({ err: error }, 'failed to open a session')
        return reply.code(500).send(internalError)
      }
    })
    .post('/v1/sessions/verify', async (request, reply) => {
      const parsed = sessionTokenRequestSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(invalidRequest)

      try {
        const session = await verifySession(db, parsed.data.token)

        return session
          ? reply.code(200).send({
              verified: true,
              userId: session.userId,
              expiresAt: session.expiresAt.toISOString(),
            })
          : reply.code(200).send({ verified: false })
      } catch (error) {
        request.log.error({ err: error }, 'failed to verify a session')
        return reply.code(500).send(internalError)
      }
    })
    // Idempotent: an unknown token, an expired one and an already revoked one are all
    // answered the same, because none of the differences is anyone's business.
    .delete('/v1/sessions', async (request, reply) => {
      const parsed = sessionTokenRequestSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send(invalidRequest)

      try {
        await revokeSession(db, parsed.data.token)
        return reply.code(204).send()
      } catch (error) {
        request.log.error({ err: error }, 'failed to revoke a session')
        return reply.code(500).send(internalError)
      }
    }).plugin
}
