import { bearerFor } from '@traiectus/auth-client/server'
import { NextResponse, type NextRequest } from 'next/server'

import { authClientConfig } from '@/server/auth-client'
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/server/session'

/**
 * The gate for /dashboard, and the only place a rotated refresh token can be written back:
 * a Server Component cannot set a cookie mid-render, so refreshing has to happen before the
 * page runs — ADR-0009 ③, "refreshes early... before forwarding the request".
 *
 * The verified access token is passed to the page as a request header rather than re-read
 * from the cookie there, so the page never has to unseal the envelope a second time.
 */
export const config = { matcher: ['/dashboard/:path*'] }

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
