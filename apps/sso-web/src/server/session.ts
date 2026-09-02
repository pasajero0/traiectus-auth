import 'server-only'

import { cookies } from 'next/headers'

/** ADR-0001 ①. */
export const SSO_COOKIE_NAME = 'traiectus_sso'

/**
 * Lax, not Strict: `/authorize` is a top-level GET from another site, and Strict withholds
 * the cookie from exactly that. `secure` follows the configured origin, not NODE_ENV.
 */
export function sessionCookieOptions({ expiresAt, secure }: { expiresAt: Date; secure: boolean }) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    // Seconds. The row is the truth; the cookie only agrees with it.
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  }
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(SSO_COOKIE_NAME)?.value ?? null
}
