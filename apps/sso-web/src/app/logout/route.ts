/**
 * GET /logout — revokes the SSO session and every refresh family belonging to
 * the user, then returns the browser where it came from. Access tokens already
 * issued live out their five minutes; nothing can recall a self-contained token.
 *
 * Day 8.
 */
export async function GET(): Promise<Response> {
  return new Response('not implemented', { status: 501 })
}
