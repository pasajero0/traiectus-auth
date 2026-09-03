import 'server-only'

/**
 * Where /login sends the browser back to. Attacker-reachable via a crafted link to
 * /api/auth/login?returnTo=…, so it is narrowed the same way sso-web narrows `next`:
 * an open redirect is the cheapest hole in exactly this kind of fork.
 */
export function returnTarget(value: string | null | undefined): string {
  const fallback = '/inbox'
  if (!value) return fallback

  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback

  try {
    return new URL(value, 'http://return-to.invalid').pathname
  } catch {
    return fallback
  }
}
