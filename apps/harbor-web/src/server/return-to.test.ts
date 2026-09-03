import 'server-only'

import { describe, expect, it } from 'vitest'

import { returnTarget } from './return-to'

/** Reachable via /api/auth/login?returnTo=…, so this is the one place an attacker's URL
 * could become a redirect. */
describe('the return target', () => {
  it('keeps a same-app path', () => {
    expect(returnTarget('/dashboard/projects')).toBe('/dashboard/projects')
  })

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['another site', 'https://not-harbor.example/dashboard'],
    ['a protocol-relative host', '//not-harbor.example/dashboard'],
    ['a host hidden behind a backslash', '/\\not-harbor.example'],
  ])('falls back to / for %s', (_label, value) => {
    expect(returnTarget(value)).toBe('/')
  })
})
