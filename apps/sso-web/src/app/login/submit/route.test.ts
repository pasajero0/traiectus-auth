import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionCookieOptions } from '@/server/session'

import { POST } from './route'

vi.mock('@/server/sso-api', () => ({
  verifyCredentials: vi.fn(),
  openSession: vi.fn(),
}))

const { openSession, verifyCredentials } = await import('@/server/sso-api')

const ORIGIN = 'http://localhost:4100'

const submit = (headers: Record<string, string>) =>
  POST(
    new Request(`${ORIGIN}/login/submit`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ email: 'someone@example.com', password: 'correct horse' }),
    }),
  )

beforeEach(() => {
  vi.resetAllMocks()
  process.env['SSO_WEB_URL'] = ORIGIN
  process.env['SSO_API_URL'] = 'http://localhost:4000'
  process.env['INTERNAL_API_KEY'] = 'test-internal-key'
})

/** The check that holds the CSRF surface closed — it runs before the body is read. */
describe('the Origin check', () => {
  it('refuses a request carrying no Origin', async () => {
    const response = await submit({})

    expect(response.status).toBe(403)
    expect(verifyCredentials).not.toHaveBeenCalled()
  })

  it('refuses a request from another site', async () => {
    const response = await submit({ origin: 'https://not-traiectus.example' })

    expect(response.status).toBe(403)
    expect(verifyCredentials).not.toHaveBeenCalled()
  })
})

describe('signing in', () => {
  it('sets the session cookie and sends the browser on', async () => {
    vi.mocked(verifyCredentials).mockResolvedValue({ verified: true, userId: 'a-user-id' })
    vi.mocked(openSession).mockResolvedValue({
      token: 'an-opaque-token',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    })

    const response = await submit({ origin: ORIGIN })
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`)
    expect(cookie).toContain('traiectus_sso=an-opaque-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Path=/')
  })

  it('says the same thing on a wrong password as on an address nobody registered', async () => {
    vi.mocked(verifyCredentials).mockResolvedValue({ verified: false })

    const response = await submit({ origin: ORIGIN })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=1`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('says the same thing again when sso-api cannot be reached', async () => {
    vi.mocked(verifyCredentials).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const response = await submit({ origin: ORIGIN })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=1`)
  })
})

describe('the cookie attributes', () => {
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000)

  it('is Secure when the application is served over https', () => {
    expect(sessionCookieOptions({ expiresAt, secure: true })).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
  })

  it('expires with the row, in whole seconds', () => {
    const { maxAge } = sessionCookieOptions({ expiresAt, secure: true })

    expect(maxAge).toBeGreaterThan(7 * 24 * 3600 - 5)
    expect(maxAge).toBeLessThanOrEqual(7 * 24 * 3600)
  })

  it('never goes negative on a session that has already expired', () => {
    expect(sessionCookieOptions({ expiresAt: new Date(0), secure: true }).maxAge).toBe(0)
  })
})
