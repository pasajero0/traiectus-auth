import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { openSuccessor, sealSuccessor, successorKey } from './successor-cipher'

const key = randomBytes(32)
const token = 'trr_JG8pHM-MMRdJv-Ma4Z7tGPYDBZA0nmK7IHOqINJ9_eI'

describe('sealing a successor', () => {
  it('comes back out under the same key', () => {
    expect(openSuccessor(key, sealSuccessor(key, token))).toBe(token)
  })

  it('never seals the same token to the same bytes twice', () => {
    expect(sealSuccessor(key, token)).not.toBe(sealSuccessor(key, token))
  })

  it('does not leave the token legible', () => {
    const sealed = sealSuccessor(key, token)

    expect(sealed).not.toContain(token)
    expect(Buffer.from(sealed, 'base64').toString('utf8')).not.toContain('trr_')
  })
})

/** Everything that fails has to fail the same way: null, never a partial answer. */
describe('opening a successor', () => {
  it('refuses another key', () => {
    expect(openSuccessor(randomBytes(32), sealSuccessor(key, token))).toBeNull()
  })

  it('refuses a row that was edited', () => {
    const raw = Buffer.from(sealSuccessor(key, token), 'base64')
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1)

    expect(openSuccessor(key, raw.toString('base64'))).toBeNull()
  })

  it('refuses a row whose authentication tag was edited', () => {
    const raw = Buffer.from(sealSuccessor(key, token), 'base64')
    raw.writeUInt8(raw.readUInt8(13) ^ 0xff, 13)

    expect(openSuccessor(key, raw.toString('base64'))).toBeNull()
  })

  it.each([['nothing', ''], ['too few bytes to hold an iv and a tag', randomBytes(20).toString('base64')]])(
    'refuses %s',
    (_label, value) => {
      expect(openSuccessor(key, value)).toBeNull()
    },
  )
})

describe('the configured key', () => {
  it('is bytes when it decodes to thirty-two of them', () => {
    expect(successorKey(key.toString('base64'))).toHaveLength(32)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['too short', randomBytes(16).toString('base64')],
    ['too long', randomBytes(48).toString('base64')],
  ])('names itself when it is %s', (_label, value) => {
    expect(() => successorKey(value)).toThrow(/REFRESH_SUCCESSOR_ENCRYPTION_KEY/)
  })
})
