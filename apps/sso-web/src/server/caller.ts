import 'server-only'

/**
 * The browser's address, for sso-api to count by — ADR-0023.
 *
 * A header a browser sets itself would be worthless, so this reads only the ones the
 * platform writes: Vercel overwrites `x-vercel-forwarded-for` and `x-real-ip`, and puts the
 * caller first in `x-forwarded-for`. Locally there is no proxy and nothing to read, so this
 * answers null and sso-api falls back to the address the connection came from.
 */
export function callerAddress(request: Request): string | null {
  const single = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip')
  if (single) return single.trim() || null

  const chain = request.headers.get('x-forwarded-for')
  return chain?.split(',')[0]?.trim() || null
}
