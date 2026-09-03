import { bearerFor } from '@traiectus/auth-client/server'
import { NextResponse, type NextRequest } from 'next/server'

import { authClientConfig } from '@/server/auth-client'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/server/session'

/**
 * The gate for the whole application — ADR-0019. A product has no page that renders
 * without a session; the exclusion is an allowlist of infrastructure, not a list of
 * protected routes, so a page added later is protected by default rather than by memory.
 *
 * A rotated refresh token can only be written back here: a Server Component cannot set a
 * cookie mid-render, so refreshing has to happen before the page runs — ADR-0009 ③.
 * The verified access token is passed to the page as a request header rather than re-read
 * from the cookie there, so the page never has to unseal the envelope a second time.
 */
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|\\.well-known).*)'],
}

export async function middleware(request: NextRequest): Promise<Response> {
  const envelope = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const secure = request.nextUrl.protocol === 'https:'

  const bearer = envelope ? await bearerFor(authClientConfig(), envelope) : null

  if (!bearer) {
    const login = new URL('/api/auth/login', request.url)
    login.searchParams.set('returnTo', request.nextUrl.pathname)

    const response = NextResponse.redirect(login)
    response.cookies.delete(SESSION_COOKIE_NAME)
    return response
  }

  const forwarded = new Headers(request.headers)
  forwarded.set('x-harbor-access-token', bearer.token)

  const response = NextResponse.next({ request: { headers: forwarded } })
  if (bearer.session) response.cookies.set(SESSION_COOKIE_NAME, bearer.session, sessionCookieOptions(secure))
  return response
}
