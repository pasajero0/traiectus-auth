import { authorizeRequestSchema } from '@traiectus/contracts'
import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { readSessionCookie } from '@/server/session'
import { issueCode } from '@/server/sso-api'

/**
 * Where every client sends a browser — ADR-0001 ②. A top-level GET that checks no Origin
 * and still creates a row; both are answered by ADR-0018.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = new URL(env().SSO_WEB_URL).origin
  const requested = new URL(request.url)

  const parsed = authorizeRequestSchema.safeParse(Object.fromEntries(requested.searchParams))
  if (!parsed.success) return refuse('invalid_request')

  try {
    const token = await readSessionCookie()

    if (token) {
      const issued = await issueCode({
        sessionToken: token,
        clientId: parsed.data.client_id,
        redirectUri: parsed.data.redirect_uri,
        codeChallenge: parsed.data.code_challenge,
      })

      if (issued.issued) {
        const back = new URL(parsed.data.redirect_uri)
        back.searchParams.set('code', issued.code)
        if (parsed.data.state) back.searchParams.set('state', parsed.data.state)
        // Which authorization server answered — RFC 9207, ADR-0017.
        back.searchParams.set('iss', origin)

        return NextResponse.redirect(back, 302)
      }

      // Refused here rather than redirected: sending anything at all to an address nobody
      // registered would confirm it.
      if (issued.reason !== 'no_session') return refuse(issued.reason)
    }
  } catch (error) {
    console.error('could not answer /authorize', error)
  }

  const login = new URL('/login', origin)
  login.searchParams.set('next', `${requested.pathname}${requested.search}`)
  return NextResponse.redirect(login, 302)
}

/** Our own page, never a redirect: the refusal must not travel to that address. */
function refuse(reason: string): Response {
  return new NextResponse(`${reason}\n`, {
    status: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
