import { z } from 'zod'

/**
 * The shared vocabulary. Schemas live here and types are derived from them, so the
 * validator and the type cannot drift apart.
 *
 * Two families: the identity protocol, and each product's API. Both sides of every
 * call import from here — sso-api validates with these, auth-client is typed by them.
 */

export const HEALTH_PATH = '/health'

/**
 * Length is the only password rule. Composition rules — a digit, a symbol, a capital —
 * push people towards `Password1!` and buy nothing; twelve characters of anything is
 * worth more. The upper bound is not a policy but a defence: argon2id will faithfully
 * hash a megabyte if asked, and that is a way to spend the server's memory.
 */
export const passwordSchema = z.string().min(12).max(256)

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254) // the longest address RFC 5321 permits

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const registerResponseSchema = z.object({
  id: z.string().uuid(),
})

export type RegisterResponse = z.infer<typeof registerResponseSchema>

/**
 * Verification, not registration: no length rule here. A password too short to have been
 * registered is a wrong password, not a malformed request. The upper bound stays — it is
 * a defence, not a policy.
 */
export const verifyCredentialsRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
})

export type VerifyCredentialsRequest = z.infer<typeof verifyCredentialsRequestSchema>

/** The outcome is the body: on this route 401 means only that the caller was refused. */
export const verifyCredentialsResponseSchema = z.discriminatedUnion('verified', [
  z.object({ verified: z.literal(true), userId: z.string().uuid() }),
  z.object({ verified: z.literal(false) }),
])

export type VerifyCredentialsResponse = z.infer<typeof verifyCredentialsResponseSchema>

/** Opening an SSO session — ADR-0001 ①. sso-web keeps the token; sso-api keeps the row. */
export const createSessionRequestSchema = z.object({ userId: z.string().uuid() })

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>

export const createSessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
})

export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>

/** Verifying and revoking take the same body, so they take the same schema. */
export const sessionTokenRequestSchema = z.object({ token: z.string().min(1).max(256) })

export type SessionTokenRequest = z.infer<typeof sessionTokenRequestSchema>

export const verifySessionResponseSchema = z.discriminatedUnion('verified', [
  z.object({
    verified: z.literal(true),
    userId: z.string().uuid(),
    expiresAt: z.string().datetime(),
  }),
  z.object({ verified: z.literal(false) }),
])

export type VerifySessionResponse = z.infer<typeof verifySessionResponseSchema>
