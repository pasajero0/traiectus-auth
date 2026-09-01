/**
 * POST /logout — revokes the SSO session and every refresh family belonging to
 * the user, then returns the browser where it came from. Access tokens already
 * issued live out their five minutes; nothing can recall a self-contained token.
 *
 * POST rather than GET, because this revokes state and ADR-0008 counts "no
 * state-changing GET" among the three things holding the CSRF surface closed.
 * SameSite=Lax withholds the cookie from a cross-site POST but sends it with a
 * plain GET, so a GET here would be forgeable from any page carrying an <img>
 * tag. Reached from a same-origin form on a signed-in page, with the Origin
 * header checked like every other state-changing request.
 *
 * Note that /authorize next door stays a GET on purpose: it is a top-level
 * navigation that changes nothing, and ADR-0001 says so explicitly.
 *
 * Day 8.
 */
export async function POST(): Promise<Response> {
  return new Response('not implemented', { status: 501 })
}
