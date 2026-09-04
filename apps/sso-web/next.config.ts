import type { NextConfig } from 'next'

/**
 * Sent on every response. `frame-ancestors` is the load-bearing one on this app: a sign-in
 * page that can be framed can be clicked through. The referrer policy still keeps the
 * address `/register` carries in its query string off outbound requests — cross-origin
 * gets the origin alone, without path or query.
 *
 * Not `no-referrer`: it makes the browser send `Origin: null` on a form navigation, which
 * every Origin-checked POST here then refuses. Tried on 04/09; it 403'd sign-in,
 * registration and both products' sign-out.
 *
 * No `script-src` yet — a policy that breaks only in production is worse than none, and it
 * needs its own pass. Known gaps.
 */
export const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

const config: NextConfig = {
  transpilePackages: ['@traiectus/contracts', '@traiectus/ui'],
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
}

export default config
