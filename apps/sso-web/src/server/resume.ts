import 'server-only'

/**
 * Where to send the browser after signing in. The value is whatever an attacker put in the
 * URL, so a redirect that follows it is an open redirect unless it is narrowed to the one
 * destination sign-in can resume: `/authorize` on this host.
 */
export function resumeTarget(next: string | null | undefined): string | null {
  if (!next) return null

  // `//host` is another site wearing a path's clothes, and a backslash is a slash to
  // enough parsers that reasoning about which ones is not worth the risk.
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null

  try {
    const url = new URL(next, 'http://resume.invalid')
    return url.pathname === '/authorize' ? `${url.pathname}${url.search}` : null
  } catch {
    return null
  }
}
