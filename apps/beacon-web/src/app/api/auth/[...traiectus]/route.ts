import { completeSignIn, signOut, startSignIn } from '@traiectus/auth-client/server'
import { NextResponse } from 'next/server'

import { authClientConfig } from '@/server/auth-client'
import { returnTarget } from '@/server/return-to'
import {
  hasRetried,
  readSessionEnvelope,
  readTransactionEnvelope,
  RETRY_COOKIE_NAME,
  retryCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  TRANSACTION_COOKIE_NAME,
  transactionCookieOptions,
} from '@/server/session'

/**
 * The BFF half of the SDK: /login, /callback, /logout for this application. The exchange
 * happens here, server-side — a code never reaches the browser — and this route is the
 * only place that writes `beacon_session`. ADR-0008.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ traiectus: string[] }> },
): Promise<Response> {
  const { traiectus } = await params
  const base = new URL(request.url).origin
  const secure = base.startsWith('https://')

  if (traiectus.at(-1) === 'login') {
    const { searchParams } = new URL(request.url)
    const started = await startSignIn(authClientConfig(), returnTarget(searchParams.get('returnTo')))

    const response = NextResponse.redirect(started.url, 302)
    response.cookies.set(TRANSACTION_COOKIE_NAME, started.transaction, transactionCookieOptions(secure))
    return response
  }

  if (traiectus.at(-1) === 'callback') {
    const { searchParams } = new URL(request.url)
    const transaction = await readTransactionEnvelope()

    const result = await completeSignIn(authClientConfig(), { params: searchParams, transaction })

    if (!result.signedIn) {
      // A GET can be replayed — a second tab, a double click, a browser prefetching the
      // link — and a transaction is one-time-use by design. If an earlier pass already
      // succeeded, this failure is a stale echo of a request that already won, not a
      // reason to show an error to someone who is, in fact, signed in.
      if (await readSessionEnvelope()) {
        const already = NextResponse.redirect(new URL('/', base), 303)
        already.cookies.delete(TRANSACTION_COOKIE_NAME)
        return already
      }

      // Missing or unreadable, which covers the ordinary case — it expired while the
      // person was at the sign-in form — and the harmless ones, a rotated seal key or a
      // mangled cookie. Starting again is what they would do themselves; a dead end is
      // not, and a fresh transaction gives an attacker nothing. Marked so a browser that
      // keeps no cookie bounces once rather than forever.
      if (result.reason === 'no_transaction' && !(await hasRetried())) {
        const again = NextResponse.redirect(new URL('/api/auth/login', base), 303)
        again.cookies.set(RETRY_COOKIE_NAME, '1', retryCookieOptions(secure))
        again.cookies.delete(TRANSACTION_COOKIE_NAME)
        return again
      }

      const failed = new NextResponse(`sign-in failed: ${result.reason}\n`, {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
      failed.cookies.delete(TRANSACTION_COOKIE_NAME)
      failed.cookies.delete(RETRY_COOKIE_NAME)
      return failed
    }

    const response = NextResponse.redirect(new URL(result.returnTo, base), 303)
    response.cookies.set(SESSION_COOKIE_NAME, result.session, sessionCookieOptions(secure))
    response.cookies.delete(TRANSACTION_COOKIE_NAME)
    response.cookies.delete(RETRY_COOKIE_NAME)
    return response
  }

  return new NextResponse('not_found', { status: 404 })
}

/**
 * The state-changing half. Checked against Origin for the same reason sso-web's
 * /login/submit is — SameSite=Lax alone withholds the cookie from a cross-site POST but
 * says nothing about a same-site page tricked into submitting one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ traiectus: string[] }> },
): Promise<Response> {
  const { traiectus } = await params
  if (traiectus.at(-1) !== 'logout') return new NextResponse('not_found', { status: 404 })

  const origin = new URL(request.url).origin
  if (request.headers.get('origin') !== origin) {
    return new NextResponse('forbidden', { status: 403 })
  }

  const outcome = signOut()

  // The SSO session is untouched: leaving this product is not the same as leaving the
  // identity layer, and the hub — signed in, showing what else is reachable — is a more
  // useful landing than a bare form that gives no sign anything happened. ADR-0020.
  const response = NextResponse.redirect(new URL('/', authClientConfig().ssoWebUrl), 303)
  if (outcome.clearSession) response.cookies.delete(SESSION_COOKIE_NAME)
  return response
}
