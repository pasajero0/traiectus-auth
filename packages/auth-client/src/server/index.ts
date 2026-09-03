import { tokenResponseSchema } from '@traiectus/contracts'

import {
  open,
  seal,
  sessionSchema,
  transactionSchema,
  type Session,
  type Transaction,
} from './envelope'

export { sessionSchema, transactionSchema, type Session, type Transaction } from './envelope'

/**
 * The BFF half: what a web application's server needs to authenticate a person.
 *
 * Runs only on a server, and only for cookie-bearing web clients. Both tokens stay inside
 * a sealed envelope this application owns; nothing here ever hands one to a browser.
 */
export type AuthClientConfig = {
  /** Where the browser is sent, and the `iss` every response must carry. */
  ssoWebUrl: string
  /** Where the exchange happens, server to server. */
  ssoApiUrl: string
  clientId: string
  clientSecret: string
  /** Must be one of the addresses the identity service has registered, exactly. */
  redirectUri: string
  /** 32 bytes, base64. Seals the envelope. */
  sealKey: string
}

/** Ten minutes to get through a sign-in form, and not a moment of it in the browser's reach. */
const TRANSACTION_SECONDS = 600

/** Refresh with this much left, so an expiring token never reaches the resource server. */
const REFRESH_MARGIN_MS = 30_000

export type SignInStart = { url: string; transaction: string }

export async function startSignIn(
  config: AuthClientConfig,
  returnTo = '/',
): Promise<SignInStart> {
  const state = randomToken()
  const codeVerifier = randomToken()

  const url = new URL('/authorize', config.ssoWebUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await challengeFor(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')

  const transaction = await seal(config.sealKey, {
    state,
    codeVerifier,
    returnTo,
    expiresAt: Date.now() + TRANSACTION_SECONDS * 1000,
  } satisfies Transaction)

  return { url: url.toString(), transaction }
}

export type SignInResult =
  | { signedIn: true; session: string; returnTo: string }
  | { signedIn: false; reason: SignInFailure }

export type SignInFailure =
  | 'no_transaction'
  | 'state_mismatch'
  | 'wrong_issuer'
  | 'authorization_failed'
  | 'exchange_failed'

/**
 * `state` proves the response answers a request this application started; `iss` proves
 * which authorization server answered — RFC 9207, ADR-0017. A missing `iss` is a failure
 * rather than a skip, because a check that applies only when the parameter is present is
 * removed by deleting the parameter.
 */
export async function completeSignIn(
  config: AuthClientConfig,
  callback: { params: URLSearchParams; transaction: string | undefined | null },
): Promise<SignInResult> {
  const transaction = await open(config.sealKey, callback.transaction, transactionSchema)
  if (!transaction || transaction.expiresAt < Date.now()) {
    return { signedIn: false, reason: 'no_transaction' }
  }

  if (callback.params.get('state') !== transaction.state) {
    return { signedIn: false, reason: 'state_mismatch' }
  }

  if (callback.params.get('iss') !== new URL(config.ssoWebUrl).origin) {
    return { signedIn: false, reason: 'wrong_issuer' }
  }

  const code = callback.params.get('code')
  if (!code) return { signedIn: false, reason: 'authorization_failed' }

  const tokens = await exchange(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: transaction.codeVerifier,
  })

  if (!tokens) return { signedIn: false, reason: 'exchange_failed' }

  return {
    signedIn: true,
    session: await seal(config.sealKey, tokens),
    returnTo: transaction.returnTo,
  }
}

export type Bearer =
  /** `session` is present only when it was rotated, and then the cookie has to be rewritten. */
  { token: string; session?: string } | null

const inFlight = new Map<string, Promise<Session | null>>()

/**
 * The bearer for one outbound call, refreshed early rather than after a 401 — this side
 * knows the expiry, so it never needs to be told. Concurrent calls on one instance share a
 * single rotation; ADR-0009 ③ explains why that is a reduction and not a guarantee.
 */
export async function bearerFor(
  config: AuthClientConfig,
  envelope: string | undefined | null,
): Promise<Bearer> {
  const session = await open(config.sealKey, envelope, sessionSchema)
  if (!session) return null

  if (session.accessExpiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return { token: session.accessToken }
  }

  const rotated = await shared(session.refreshToken, () => rotate(config, session.refreshToken))
  if (!rotated) return null

  return { token: rotated.accessToken, session: await seal(config.sealKey, rotated) }
}

export type RefreshResult =
  | { refreshed: true; session: string }
  | { refreshed: false; reason: 'no_session' | 'rotation_refused' }

export async function refresh(
  config: AuthClientConfig,
  envelope: string | undefined | null,
): Promise<RefreshResult> {
  const session = await open(config.sealKey, envelope, sessionSchema)
  if (!session) return { refreshed: false, reason: 'no_session' }

  const rotated = await shared(session.refreshToken, () => rotate(config, session.refreshToken))
  if (!rotated) return { refreshed: false, reason: 'rotation_refused' }

  return { refreshed: true, session: await seal(config.sealKey, rotated) }
}

/**
 * Clearing the cookie is this application's whole share of signing out. Revoking the family
 * and the SSO session belongs to the identity service and arrives with single logout.
 */
export function signOut(): { clearSession: true } {
  return { clearSession: true }
}

async function rotate(config: AuthClientConfig, refreshToken: string): Promise<Session | null> {
  return exchange(config, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

async function exchange(
  config: AuthClientConfig,
  body: Record<string, string>,
): Promise<Session | null> {
  const response = await fetch(new URL('/v1/token', config.ssoApiUrl), {
    method: 'POST',
    headers: {
      authorization: `Basic ${base64(`${config.clientId}:${config.clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
  })

  if (!response.ok) return null

  const parsed = tokenResponseSchema.safeParse(await response.json())
  if (!parsed.success) return null

  return {
    accessToken: parsed.data.access_token,
    accessExpiresAt: Date.now() + parsed.data.expires_in * 1000,
    refreshToken: parsed.data.refresh_token,
  }
}

function shared(key: string, work: () => Promise<Session | null>): Promise<Session | null> {
  const running = inFlight.get(key)
  if (running) return running

  const started = work().finally(() => inFlight.delete(key))
  inFlight.set(key, started)

  return started
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function base64(value: string): string {
  return btoa(value)
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
