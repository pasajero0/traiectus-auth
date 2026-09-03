import { verifyCredentialsRequestSchema } from '@traiectus/contracts'

import type { Database } from '../db/client'
import { verifyCredentials } from '../domain/credentials'
import type { Env } from '../env'
import { internalRouter } from '../routing'

/**
 * Equal-time failure (ADR unnamed — the property is in `domain/credentials.ts`) means an
 * unknown address costs the same argon2id hash as a real one, so this number bounds how
 * many hashes the instance pays for per minute, not how many guesses one account survives.
 * sso-web is the only caller and does not forward the browser's address, so every request
 * here shares one bucket by design: high enough for real concurrent sign-ins on a
 * single-digit-user demo, low enough that a sustained guesser pays for it in wall-clock
 * time, not just CPU. Meaningful per-account brute-force protection still needs the
 * client-IP-forwarding gap this bucket can't close on its own — see Known gaps.
 */
const CREDENTIALS_VERIFY_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }

/**
 * Internal: only sso-web reaches this service, and the key authenticates the caller, not
 * the person signing in — the principal comes from the password checked below (ADR-0007).
 * A failed check is a 200 whose body says no, so 401 keeps its one meaning.
 */
export function credentialRoutes(env: Env, db: Database) {
  return internalRouter(env).post(
    '/v1/credentials/verify',
    async (request, reply) => {
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
    },
    { config: { rateLimit: CREDENTIALS_VERIFY_RATE_LIMIT } },
  ).plugin
}
