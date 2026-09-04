import { describe, expect, it } from 'vitest'

import config, { securityHeaders } from '../../next.config'

/**
 * Pins the policy rather than the file: these are the headers a browser actually receives,
 * and each one is here because removing it re-opens something.
 */
const required = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

describe('the security headers', () => {
  it.each(Object.entries(required))('sends %s', (key, value) => {
    expect(securityHeaders).toContainEqual({ key, value })
  })

  it('applies them to every path, not just the pages that remembered to ask', async () => {
    const rules = await config.headers?.()

    expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }])
  })
})
