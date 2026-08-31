/**
 * The BFF half of the SDK: /login, /callback, /logout, /refresh for this
 * application. It performs the authorization-code exchange server-side — the
 * code never reaches the browser — and owns the `harbor_session` cookie on
 * this application's own host.
 *
 * The identity service never sets a cookie here. It cannot: different origin.
 *
 * Day 6, once @traiectus/auth-client/server exists.
 */
export async function GET(): Promise<Response> {
  return new Response('not implemented', { status: 501 })
}

export async function POST(): Promise<Response> {
  return new Response('not implemented', { status: 501 })
}
