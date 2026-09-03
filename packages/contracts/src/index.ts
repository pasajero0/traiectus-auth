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

/**
 * The shape of an authorization request — ADR-0001 ②. Shape only: the allowlist that
 * decides whether a redirect_uri is one of ours arrives with the codes, 04/09.
 */
export const authorizeRequestSchema = z.object({
  client_id: z.string().min(1).max(64),
  redirect_uri: z.string().url().max(2048),
  response_type: z.literal('code'),
  state: z.string().min(1).max(512).optional(),
  /** BASE64URL(SHA256(verifier)) — 43 characters, and nothing else is accepted. */
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** No `plain`: a downgrade path is the attack it would be defending against. ADR-0016. */
  code_challenge_method: z.literal('S256'),
})

/** RFC 7636's verifier: 43 to 128 characters of the unreserved set. */
export const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)

export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>

/** Issuing an authorization code. Internal: only sso-web asks, and it asks with a session. */
export const issueCodeRequestSchema = z.object({
  sessionToken: z.string().min(1).max(256),
  clientId: z.string().min(1).max(64),
  redirectUri: z.string().url().max(2048),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

export type IssueCodeRequest = z.infer<typeof issueCodeRequestSchema>

/**
 * The refusal carries a reason because sso-web has to answer differently: an invalid session
 * sends the browser to sign in, while an unregistered client or redirect must not produce a
 * redirect at all.
 */
export const issueCodeResponseSchema = z.discriminatedUnion('issued', [
  z.object({
    issued: z.literal(true),
    code: z.string().min(1),
    expiresAt: z.string().datetime(),
  }),
  z.object({
    issued: z.literal(false),
    reason: z.enum(['no_session', 'unknown_client', 'redirect_not_allowed']),
  }),
])

export type IssueCodeResponse = z.infer<typeof issueCodeResponseSchema>

/**
 * The token endpoint — RFC 6749's two grants, and no others. The client authenticates with
 * HTTP Basic; nothing about the client travels in this body.
 */
export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1).max(256),
    redirect_uri: z.string().url().max(2048),
    code_verifier: codeVerifierSchema,
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1).max(256),
  }),
])

export type TokenRequest = z.infer<typeof tokenRequestSchema>

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
})

export type TokenResponse = z.infer<typeof tokenResponseSchema>

/** What sso-web shows on its own dashboard — never a secret, never a redirect_uri. */
export const clientsResponseSchema = z.object({
  clients: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      homeUrl: z.string().url(),
    }),
  ),
})

export type ClientsResponse = z.infer<typeof clientsResponseSchema>
