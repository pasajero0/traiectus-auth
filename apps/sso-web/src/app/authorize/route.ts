import { authorizeRequestSchema } from '@traiectus/contracts'
import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { readSessionCookie } from '@/server/session'
import { verifySession } from '@/server/sso-api'

/**
 * The entry point every client redirects a browser to — ADR-0001 ②. A valid SSO session is
 * what makes the second application's sign-in invisible; issuing the code arrives 04/09.
 *
 * A top-level GET that checks no Origin: browsers send none on a navigation, and arriving
 * from another site is the point rather than the attack.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = new URL(env().SSO_WEB_URL).origin
  const requested = new URL(request.url)

  const parsed = authorizeRequestSchema.safeParse(Object.fromEntries(requested.searchParams))
  if (!parsed.success) return new NextResponse('invalid_request', { status: 400 })

  const session = await currentSession()

  if (!session) {
    const login = new URL('/login', origin)
    login.searchParams.set('next', `${requested.pathname}${requested.search}`)
    return NextResponse.redirect(login, 302)
  }

  return new NextResponse('Signed in. Issuing the authorization code arrives 04/09.\n', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

// An unreachable sso-api is not a session. The browser is sent to sign in, where it will
// meet the same failure with a message rather than a redirect loop.
async function currentSession(): Promise<{ userId: string } | null> {
  try {
    const token = await readSessionCookie()
    if (!token) return null

    const result = await verifySession(token)
    return result.verified ? { userId: result.userId } : null
  } catch (error) {
    console.error('could not check the SSO session', error)
    return null
  }
}
