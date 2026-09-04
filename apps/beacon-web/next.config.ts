import type { NextConfig } from 'next'

/**
 * Sent on every response. `frame-ancestors` keeps a signed-in product page out of someone
 * else's iframe; cross-origin requests carry the origin alone, without path or query.
 *
 * Not `no-referrer`: it makes the browser send `Origin: null` on a form navigation, which
 * the Origin check on this app's own sign-out POST then refuses. Tried on 04/09.
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
  // Workspace packages ship as TypeScript source rather than a build output,
  // so there is no build graph to keep in sync during development.
  transpilePackages: ['@traiectus/contracts', '@traiectus/auth-client', '@traiectus/ui'],
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
}

export default config
