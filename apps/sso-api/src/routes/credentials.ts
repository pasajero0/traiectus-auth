import { verifyCredentialsRequestSchema } from '@traiectus/contracts'
import type { FastifyRequest } from 'fastify'

import {
  callerAddress,
  nothingLeft,
  wentOver,
  type FailureCounter,
  type HashBudget,
} from '../caller'
import type { Database } from '../db/client'
import { verifyCredentials } from '../domain/credentials'
import type { Env } from '../env'
import { internalRouter } from '../routing'
import { tooMany } from '../too-many'

/**
 * The coarse net, and deliberately the *secondary* one. OWASP puts the primary counter on
 * the account rather than the address, because an attacker with a hundred addresses walks
 * through an address limit untouched; this one catches a single host working through many
 * accounts. Thirty a minute leaves room for an office or a mobile carrier, where a great
 * many people share one address.
 */
const CREDENTIALS_VERIFY_RATE_LIMIT = (env: Env) => ({
  max: 30,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) => callerAddress(env, request),
})

/**
 * The primary counter — NIST SP 800-63B: a verifier limits failed attempts against one
 * account, so that guessing is bounded however many addresses the guessing comes from.
 * Twenty in fifteen minutes sits well below its ceiling of a hundred.
 *
 * Failures only. A person who types the right password is never counted, so this cannot
 * be used to lock someone out of their own account by guessing at it — the denial of
 * service OWASP warns lockout invites.
 *
 * Instantiated in `server.ts`, where the app exists; the shape lives here, where the body
 * it reads is understood.
 */
export const SIGN_IN_FAILURE_LIMIT = {
  max: 20,
  timeWindow: '15 minutes',
  keyGenerator: (request: FastifyRequest) => `account:${accountOf(request.body)}`,
}

/** Already validated by the time this runs; unparseable bodies never reach the counter. */
function accountOf(body: unknown): string {
  const email = (body as { email?: unknown } | null)?.email
  return typeof email === 'string' ? email : 'unknown'
}

/**
 * Internal: only sso-web reaches this service, and the key authenticates the caller, not
 * the person signing in — the principal comes from the password checked below (ADR-0007).
 * A failed check is a 200 whose body says no, so 401 keeps its one meaning.
 */
export function credentialRoutes(
  env: Env,
  db: Database,
  hashBudget: HashBudget,
  signInFailures: FailureCounter,
) {
  return internalRouter(env).post(
    '/v1/credentials/verify',
    async (request, reply) => {
      const parsed = verifyCredentialsRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' })
      }

      // Read without spending: this account's budget is spent by getting it wrong, below.
      const account = await signInFailures(request, { increment: false })
      if (nothingLeft(account)) return tooMany(reply, account)

      // The whole service's hashing budget, which an attacker cannot escape by asking
      // from somewhere else. ADR-0023.
      const budget = await hashBudget(request)
      if (wentOver(budget)) return tooMany(reply, budget)

      try {
        const principal = await verifyCredentials(db, parsed.data)

        if (!principal) {
          await signInFailures(request)
          return reply.code(200).send({ verified: false })
        }

        return reply.code(200).send({ verified: true, userId: principal.userId })
      } catch (error) {
        // Logged without the body: it carries the password.
        request.log.error({ err: error }, 'failed to verify credentials')
        return reply.code(500).send({ error: 'internal_error' })
      }
    },
    { config: { rateLimit: CREDENTIALS_VERIFY_RATE_LIMIT(env) } },
  ).plugin
}
