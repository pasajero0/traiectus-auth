import { registerRequestSchema } from '@traiectus/contracts'

import type { Database } from '../db/client'
import { users } from '../db/schema'
import { hashPassword } from '../domain/password'
import type { Env } from '../env'
import { internalRouter } from '../routing'

/** Postgres raises this when a unique constraint is violated. */
const UNIQUE_VIOLATION = '23505'
const EMAIL_CONSTRAINT = 'users_email_unique'

/**
 * Drizzle wraps the driver's error, so the SQLSTATE sits on the cause rather than on
 * the error handed to us. The chain is walked rather than assumed: how deep the
 * wrapping goes is a detail of a dependency, and dependencies change.
 */
function driverError(error: unknown): Record<string, unknown> | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const record = current as Record<string, unknown>
    if (typeof record['code'] === 'string') return record
    current = record['cause']
  }
  return null
}

/**
 * Registration. Internal: the browser never reaches this service, only sso-web does,
 * carrying the shared secret.
 *
 * The answer is truthful — 409 when the address is taken. An internal API that lies to its
 * only caller cannot be reasoned about by the caller, and buys nothing: whoever can reach
 * it already holds the secret.
 *
 * sso-web passes that conflict on to the person rather than hiding it, and ADR-0022 is why:
 * registration signs them in on success, so the outcome is readable from where the browser
 * lands however the message is worded. Signing in is the path that hides it, in both
 * message and hash timing.
 */
export function userRoutes(env: Env, db: Database) {
  return internalRouter(env).post('/v1/users', async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    // Zod has already trimmed and lower-cased it; the database checks the same thing
    // again, because a rule only the application enforces is one refactor from gone.
    const { email, password } = parsed.data

    try {
      const [created] = await db
        .insert(users)
        .values({ email, passwordHash: await hashPassword(password) })
        .returning({ id: users.id })

      // The insert returned no row, which the types allow and reality should not.
      if (!created) return reply.code(500).send({ error: 'internal_error' })

      return reply.code(201).send({ id: created.id })
    } catch (error) {
      const driver = driverError(error)
      // Matched on the constraint by name, not on the code alone: another unique
      // constraint on this table would otherwise be answered as a taken address.
      // If the constraint is ever renamed this stops matching and the request fails
      // loudly, which is the better of the two ways to be wrong.
      if (
        driver?.['code'] === UNIQUE_VIOLATION &&
        driver['constraint_name'] === EMAIL_CONSTRAINT
      ) {
        return reply.code(409).send({ error: 'email_taken' })
      }
      // Logged without the body: it carries the password.
      request.log.error({ err: error }, 'failed to create user')
      return reply.code(500).send({ error: 'internal_error' })
    }
  }).plugin
}
