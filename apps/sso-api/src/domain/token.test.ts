import { describe, expect, it } from 'vitest'

import { hashToken, isTokenOfKind, mintToken, TOKEN_PREFIXES } from './token'

describe('a minted token', () => {
  it('carries its kind and 256 bits of body', () => {
    expect(mintToken('session')).toMatch(/^trs_[A-Za-z0-9_-]{43}$/)
    expect(mintToken('refresh')).toMatch(/^trr_[A-Za-z0-9_-]{43}$/)
    expect(mintToken('code')).toMatch(/^trc_[A-Za-z0-9_-]{43}$/)
  })

  it('is never minted twice', () => {
    expect(mintToken('refresh')).not.toBe(mintToken('refresh'))
  })

  it('is not recoverable from what is stored', () => {
    const token = mintToken('session')
    const stored = hashToken(token)

    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).not.toContain(token)
    expect(hashToken(token)).toBe(stored)
  })

  it('hashes the prefix too, so two kinds cannot collide', () => {
    const body = mintToken('session').slice(TOKEN_PREFIXES.session.length)

    expect(hashToken(`trs_${body}`)).not.toBe(hashToken(`trr_${body}`))
  })
})

/** The check that runs before any lookup — ADR-0014. */
describe('the kind check', () => {
  it('accepts a token of its own kind', () => {
    expect(isTokenOfKind(mintToken('refresh'), 'refresh')).toBe(true)
  })

  it('refuses a token of another kind', () => {
    const session = mintToken('session')

    expect(isTokenOfKind(session, 'refresh')).toBe(false)
    expect(isTokenOfKind(session, 'code')).toBe(false)
  })

  it.each([
    ['nothing but the prefix', 'trs_'],
    ['a body that is too short', 'trs_tooshort'],
    ['a body that is too long', `trs_${'a'.repeat(44)}`],
    ['a body outside base64url', `trs_${'+'.repeat(43)}`],
    ['a bare body with no prefix', 'a'.repeat(43)],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(isTokenOfKind(value, 'session')).toBe(false)
  })
})
