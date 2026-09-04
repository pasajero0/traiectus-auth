import type { NextConfig } from 'next'

/**
 * Sent on every response. `frame-ancestors` is the load-bearing one on this app: a sign-in
 * page that can be framed can be clicked through. `no-referrer` keeps the address that
 * `/register` carries in its query string on a rejected attempt out of outbound requests.
 *
 * No `script-src` yet — a policy that breaks only in production is worse than none, and it
 * needs its own pass. Known gaps.
 */
export const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

const config: NextConfig = {
  transpilePackages: ['@traiectus/contracts', '@traiectus/ui'],
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
}

export default config
