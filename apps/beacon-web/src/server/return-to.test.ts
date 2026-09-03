import 'server-only'

import { describe, expect, it } from 'vitest'

import { returnTarget } from './return-to'

/** Reachable via /api/auth/login?returnTo=…, so this is the one place an attacker's URL
 * could become a redirect. */
describe('the return target', () => {
  it('keeps a same-app path', () => {
    expect(returnTarget('/inbox/threads')).toBe('/inbox/threads')
  })

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['another site', 'https://not-beacon.example/inbox'],
    ['a protocol-relative host', '//not-beacon.example/inbox'],
    ['a host hidden behind a backslash', '/\\not-beacon.example'],
  ])('falls back to /inbox for %s', (_label, value) => {
    expect(returnTarget(value)).toBe('/inbox')
  })
})
