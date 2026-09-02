import { verifyCredentialsRequestSchema } from '@traiectus/contracts'

import type { Database } from '../db/client'
import { verifyCredentials } from '../domain/credentials'
import type { Env } from '../env'
import { internalRouter } from '../routing'

/**
 * Internal: only sso-web reaches this service, and the key authenticates the caller, not
 * the person signing in — the principal comes from the password checked below (ADR-0007).
 * A failed check is a 200 whose body says no, so 401 keeps its one meaning.
 */
export function credentialRoutes(env: Env, db: Database) {
  return internalRouter(env).post('/v1/credentials/verify', async (request, reply) => {
    const parsed = verifyCredentialsRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    try {
      const principal = await verifyCredentials(db, parsed.data)

      return principal
        ? reply.code(200).send({ verified: true, userId: principal.userId })
        : reply.code(200).send({ verified: false })
    } catch (error) {
      // Logged without the body: it carries the password.
      request.log.error({ err: error }, 'failed to verify credentials')
      return reply.code(500).send({ error: 'internal_error' })
    }
  }).plugin
}
