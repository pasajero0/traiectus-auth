import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { SSO_COOKIE_NAME, sessionCookieOptions } from '@/server/session'
import { openSession, registerUser } from '@/server/sso-api'

/**
 * The state-changing half of registration, mirroring `login/submit/route.ts`'s shape.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(env().SSO_WEB_URL).origin

  if (request.headers.get('origin') !== origin) {
    return new NextResponse('forbidden', { status: 403 })
  }

  try {
    const form = await request.formData()
    const email = form.get('email')
    const password = form.get('password')
    const confirmPassword = form.get('confirmPassword')

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      typeof confirmPassword !== 'string'
    ) {
      return rejected(origin, '1')
    }

    // Checked here too, not just by the client-side field: a request can always skip the
    // page's own JS and post the form directly.
    if (password !== confirmPassword) return rejected(origin, 'mismatch')

    const result = await registerUser(email, password)
    if (result.outcome === 'email_taken') return rejected(origin, 'email_taken')

    const { token, expiresAt } = await openSession(result.userId)

    const response = NextResponse.redirect(new URL('/', origin), 303)
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
    console.error('registration failed', error)
    return rejected(origin, '1')
  }
}

function rejected(origin: string, error: string): Response {
  const register = new URL('/register', origin)
  register.searchParams.set('error', error)
  return NextResponse.redirect(register, 303)
}
