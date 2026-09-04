import 'server-only'

import { cookies } from 'next/headers'

/**
 * This application's own session — ADR-0001 ③. Both tokens live sealed inside one cookie
 * on this host; nothing here ever reaches the browser as a bearer.
 */
export const SESSION_COOKIE_NAME = 'beacon_session'

/** The PKCE transaction between /login and /callback. Ten minutes, matching auth-client. */
export const TRANSACTION_COOKIE_NAME = 'beacon_txn'

/** Set for one bounce only, so an expired transaction cannot become a redirect loop. */
export const RETRY_COOKIE_NAME = 'beacon_signin_retry'

function cookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/** 14 days is the outer bound; what actually gates access is the envelope inside. */
export function sessionCookieOptions(secure: boolean) {
  return cookieOptions(secure, 14 * 24 * 3600)
}

export function transactionCookieOptions(secure: boolean) {
  return cookieOptions(secure, 600)
}

export async function readSessionEnvelope(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE_NAME)?.value ?? null
}

export function retryCookieOptions(secure: boolean) {
  return cookieOptions(secure, 60)
}

export async function readTransactionEnvelope(): Promise<string | null> {
  const store = await cookies()
  return store.get(TRANSACTION_COOKIE_NAME)?.value ?? null
}

export async function hasRetried(): Promise<boolean> {
  const store = await cookies()
  return store.get(RETRY_COOKIE_NAME) !== undefined
}
