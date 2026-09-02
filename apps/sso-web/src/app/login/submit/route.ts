import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { resumeTarget } from '@/server/resume'
import { SSO_COOKIE_NAME, sessionCookieOptions } from '@/server/session'
import { openSession, verifyCredentials } from '@/server/sso-api'

/**
 * The state-changing half of sign-in, and the one door a rate limiter is fitted to on
 * 07/09. A route handler, not a Server Action: the Origin check has to be a readable line.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(env().SSO_WEB_URL).origin

  // SameSite=Lax sends the cookie with a cross-site GET, so this is what closes the CSRF
  // surface on the one request that opens a session. ADR-0008.
  if (request.headers.get('origin') !== origin) {
    return new NextResponse('forbidden', { status: 403 })
  }

  let resume: string | null = null

  try {
    const form = await request.formData()
    const email = form.get('email')
    const password = form.get('password')
    resume = resumeTarget(typeof form.get('next') === 'string' ? String(form.get('next')) : null)

    if (typeof email !== 'string' || typeof password !== 'string') return rejected(origin, resume)

    const checked = await verifyCredentials(email, password)
    if (!checked.verified) return rejected(origin, resume)

    const { token, expiresAt } = await openSession(checked.userId)

    const response = NextResponse.redirect(new URL(resume ?? '/', origin), 303)
    response.cookies.set(
      SSO_COOKIE_NAME,
      token,
      sessionCookieOptions({
        expiresAt: new Date(expiresAt),
        secure: origin.startsWith('https://'),
      }),
    )
    return response
  } catch (error) {
    // Unreachable sso-api looks like a wrong password to the browser. The difference is here.
    console.error('sign-in failed', error)
    return rejected(origin, resume)
  }
}

/** Carries `next` back, so a mistyped password does not lose the client that sent us here. */
function rejected(origin: string, resume: string | null): Response {
  const login = new URL('/login', origin)
  login.searchParams.set('error', '1')
  if (resume) login.searchParams.set('next', resume)
  return NextResponse.redirect(login, 303)
}
