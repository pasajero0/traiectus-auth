import 'server-only'

/**
 * Reads and writes `traiectus_sso`: HttpOnly, Secure, SameSite=Lax, scoped to
 * this application's own host. Hard limit seven days, sliding limit twenty-four
 * hours; the row behind it lives in sso-api so it can be revoked. See ADR-0001.
 *
 * Day 3.
 */

export const SSO_COOKIE_NAME = 'traiectus_sso'
