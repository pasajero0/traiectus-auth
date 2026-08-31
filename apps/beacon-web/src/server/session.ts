import 'server-only'

/**
 * This application's own session: an AEAD-sealed envelope — access token, its
 * expiry, refresh token — in an HttpOnly, Secure, SameSite=Lax cookie on this
 * host, carrying the `__Host-` prefix in production.
 *
 * No token reaches the browser. The page calls this application's own routes
 * with nothing but the cookie; the server unseals and attaches the bearer to
 * beacon-api itself. See docs/decisions/0008-no-token-reaches-the-browser.md.
 *
 * Day 6.
 */

export const SESSION_COOKIE_NAME = 'beacon_session'
