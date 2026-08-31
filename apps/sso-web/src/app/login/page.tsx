/**
 * The sign-in page. Server-rendered, same origin as the session cookie it will
 * cause to be set — see ADR-0004 for why this page does not live in the API service.
 *
 * Day 3: the form, posting to a route handler in this app, which calls
 * POST /v1/credentials/verify and POST /v1/sessions on sso-api and sets the cookie.
 */
export default function LoginPage() {
  return (
    <main>
      <p className="eyebrow">traiectus</p>
      <h1>Sign in</h1>
      <p className="status">Not built yet — day 3.</p>
    </main>
  )
}
