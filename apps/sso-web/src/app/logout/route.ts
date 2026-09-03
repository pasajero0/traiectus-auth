import { NextResponse } from 'next/server'

import { env } from '@/server/env'
import { SSO_COOKIE_NAME, readSessionCookie } from '@/server/session'
import { revokeSession } from '@/server/sso-api'

/**
 * Revokes the SSO session, then returns to `/`. This is the only place `traiectus_sso` can
 * be cleared — it belongs to this origin, and no product can reach it.
 *
 * Every refresh family a product has already issued keeps rotating on its own terms until
 * single logout (07/09) revokes those too — this closes the SSO session, not every session
 * anywhere. Access tokens already issued are not recalled, per ADR-0001.
 *
 * POST, and Origin-checked: SameSite=Lax sends this cookie on a cross-site GET, so a plain
 * GET here would be forgeable from any page carrying an `<img>` tag. Reached only from the
 * dashboard's own same-origin form.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(env().SSO_WEB_URL).origin

  if (request.headers.get('origin') !== origin) {
    return new NextResponse('forbidden', { status: 403 })
  }

  const token = await readSessionCookie()
  if (token) await revokeSession(token)

  const response = NextResponse.redirect(new URL('/', origin), 303)
  response.cookies.delete(SSO_COOKIE_NAME)
  return response
}
