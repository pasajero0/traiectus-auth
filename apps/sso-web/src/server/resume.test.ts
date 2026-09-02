import 'server-only'

import { describe, expect, it } from 'vitest'

import { resumeTarget } from './resume'

/** The one place an attacker-supplied URL could become a redirect. */
describe('the resume target', () => {
  it('keeps an /authorize path with its query', () => {
    const next = '/authorize?client_id=harbor&response_type=code&state=abc'

    expect(resumeTarget(next)).toBe(next)
  })

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['another site', 'https://not-traiectus.example/authorize'],
    ['a protocol-relative host', '//not-traiectus.example/authorize'],
    ['a host hidden behind a backslash', '/\\not-traiectus.example'],
    ['another page on this host', '/login'],
    ['a path that merely starts as /authorize', '/authorize-elsewhere'],
    ['a traversal back out of /authorize', '/authorize/../login'],
  ])('drops %s', (_label, value) => {
    expect(resumeTarget(value)).toBeNull()
  })
})
