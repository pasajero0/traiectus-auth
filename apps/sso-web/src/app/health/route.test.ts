import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'http://localhost:4100'
const ENV_KEYS = ['SSO_API_URL', 'INTERNAL_API_KEY', 'SSO_WEB_URL'] as const

/**
 * `env()` caches on first successful parse — real behaviour, not a test artifact, so a
 * fresh module per test is what lets both a correct and a misconfigured deploy live in one
 * file without one leaking its cache into the other.
 */
beforeEach(() => {
  vi.resetModules()
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('a correctly configured deploy', () => {
  it('answers ok and reveals nothing beyond that', async () => {
    process.env['SSO_API_URL'] = 'http://localhost:4000'
    process.env['INTERNAL_API_KEY'] = 'test-internal-key'
    process.env['SSO_WEB_URL'] = ORIGIN
    const { GET } = await import('./route')

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'ok', service: 'sso-web' })
    expect(typeof body.uptimeSeconds).toBe('number')
  })
})

describe('a deploy missing a required variable', () => {
  it('answers 500 and names which one', async () => {
    process.env['SSO_API_URL'] = 'http://localhost:4000'
    process.env['SSO_WEB_URL'] = ORIGIN
    // INTERNAL_API_KEY left unset.
    const { GET } = await import('./route')

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.status).toBe('misconfigured')
    expect(body.error).toContain('INTERNAL_API_KEY')
  })
})
