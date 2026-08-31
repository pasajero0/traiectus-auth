/**
 * GET /authorize — the entry point every client redirects a browser to.
 *
 * Reads the SSO session cookie. If it is valid, asks sso-api for a single-use
 * authorization code and redirects straight back to the client's redirect_uri:
 * that silent pass is what makes the second application's sign-in invisible.
 * If it is not, sends the browser to /login and resumes afterwards.
 *
 * Top-level GET navigation only — a SameSite=Lax cookie is withheld from a
 * cross-site POST, so the flow cannot be anything else. See ADR-0001.
 *
 * Day 5.
 */
export async function GET(): Promise<Response> {
  return new Response('not implemented', { status: 501 })
}
