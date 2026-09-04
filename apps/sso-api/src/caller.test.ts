import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'

import { callerAddress, CLIENT_IP_HEADER } from './caller'
import { loadEnv } from './env'

const env = loadEnv({
  NODE_ENV: 'test',
  INTERNAL_API_KEY: 'the-internal-key',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
} as NodeJS.ProcessEnv)

/** Only the two fields the function reads; the rest of a request is beside the point. */
const asking = (headers: Record<string, string>, ip = '10.0.0.1') =>
  ({ headers, ip }) as unknown as FastifyRequest

const withKey = { 'x-traiectus-internal-key': 'the-internal-key' }

describe('who the rate limit counts', () => {
  it('takes the forwarded address from a caller holding the internal key', () => {
    const request = asking({ ...withKey, [CLIENT_IP_HEADER]: '203.0.113.9' })

    expect(callerAddress(env, request)).toBe('203.0.113.9')
  })

  /** The header is trivially forged. Unchecked, it would let anyone spend a stranger's quota. */
  it('ignores a forwarded address from a caller without the key', () => {
    const request = asking({ [CLIENT_IP_HEADER]: '203.0.113.9' })

    expect(callerAddress(env, request)).toBe('10.0.0.1')
  })

  it('ignores it again when the key is merely wrong', () => {
    const request = asking({
      'x-traiectus-internal-key': 'not-the-internal-key',
      [CLIENT_IP_HEADER]: '203.0.113.9',
    })

    expect(callerAddress(env, request)).toBe('10.0.0.1')
  })

  it('falls back to the connection when nothing was forwarded', () => {
    expect(callerAddress(env, asking(withKey))).toBe('10.0.0.1')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['longer than any address', 'a'.repeat(46)],
  ])('refuses a %s value rather than keying on it', (_label, value) => {
    const request = asking({ ...withKey, [CLIENT_IP_HEADER]: value })

    expect(callerAddress(env, request)).toBe('10.0.0.1')
  })
})
