import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { openSession, verifyCredentials } from '@/server/sso-api'
import { SSO_COOKIE_NAME, sessionCookieOptions } from '@/server/session'

/**
 * The state-changing half of sign-in, and the one door a rate limiter is fitted to on
 * 07/09. A route handler, not a Server Action: the Origin check has to be a readable line.
 */
export async function POST(request: Request): Promise<Response> {
  const { SSO_WEB_URL } = env()
  const origin = new URL(SSO_WEB_URL).origin

  // SameSite=Lax sends the cookie with a cross-site GET, so this is what closes the CSRF
  // surface on the one request that opens a session. ADR-0008.
  if (request.headers.get('origin') !== origin) {
    return new NextResponse('forbidden', { status: 403 })
  }

  const rejected = NextResponse.redirect(new URL('/login?error=1', origin), 303)

  try {
    const form = await request.formData()
    const email = form.get('email')
    const password = form.get('password')

    if (typeof email !== 'string' || typeof password !== 'string') return rejected

    const checked = await verifyCredentials(email, password)
    if (!checked.verified) return rejected

    const { token, expiresAt } = await openSession(checked.userId)

    const response = NextResponse.redirect(new URL('/', origin), 303)
    response.cookies.set(SSO_COOKIE_NAME, token, {
      ...sessionCookieOptions({
        expiresAt: new Date(expiresAt),
        secure: origin.startsWith('https://'),
      }),
    })
    return response
  } catch (error) {
    // Unreachable sso-api looks like a wrong password to the browser. The difference is here.
    console.error('sign-in failed', error)
    return rejected
  }
}
