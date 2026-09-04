import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

vi.mock('@/server/sso-api', () => ({
  registerUser: vi.fn(),
  openSession: vi.fn(),
}))

const { openSession, registerUser } = await import('@/server/sso-api')

const ORIGIN = 'http://localhost:4100'

const submit = (
  headers: Record<string, string>,
  fields: Record<string, string> = {
    email: 'someone@example.com',
    password: 'correct horse battery',
    confirmPassword: 'correct horse battery',
  },
) =>
  POST(
    new Request(`${ORIGIN}/register/submit`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields),
    }),
  )

beforeEach(() => {
  vi.resetAllMocks()
  process.env['SSO_WEB_URL'] = ORIGIN
  process.env['SSO_API_URL'] = 'http://localhost:4000'
  process.env['INTERNAL_API_KEY'] = 'test-internal-key'
})

describe('the Origin check', () => {
  it('refuses a request carrying no Origin', async () => {
    const response = await submit({})

    expect(response.status).toBe(403)
    expect(registerUser).not.toHaveBeenCalled()
  })

  it('refuses a request from another site', async () => {
    const response = await submit({ origin: 'https://not-traiectus.example' })

    expect(response.status).toBe(403)
    expect(registerUser).not.toHaveBeenCalled()
  })
})

describe('registering', () => {
  it('sets the session cookie and sends the browser to the dashboard', async () => {
    vi.mocked(registerUser).mockResolvedValue({ outcome: 'created', userId: 'a-user-id' })
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
  })

  it('refuses two passwords that do not match, without ever calling sso-api', async () => {
    const response = await submit(
      { origin: ORIGIN },
      { email: 'someone@example.com', password: 'correct horse battery', confirmPassword: 'wrong' },
    )
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(303)
    expect(location.pathname).toBe('/register')
    expect(location.searchParams.get('error')).toBe('mismatch')
    expect(registerUser).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('names a taken address honestly, unlike login', async () => {
    vi.mocked(registerUser).mockResolvedValue({ outcome: 'email_taken' })

    const response = await submit({ origin: ORIGIN })
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(303)
    expect(location.searchParams.get('error')).toBe('email_taken')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('carries the address back so a rejected attempt does not cost it too', async () => {
    vi.mocked(registerUser).mockResolvedValue({ outcome: 'email_taken' })

    const response = await submit({ origin: ORIGIN })
    const location = new URL(response.headers.get('location') ?? '')

    expect(location.searchParams.get('email')).toBe('someone@example.com')
  })

  /** A password in a URL is written to history and to every log on the way. ADR-0008. */
  it('never puts either password in the redirect it answers with', async () => {
    vi.mocked(registerUser).mockResolvedValue({ outcome: 'email_taken' })

    const mismatched = await submit(
      { origin: ORIGIN },
      { email: 'someone@example.com', password: 'correct horse battery', confirmPassword: 'wrong' },
    )
    const taken = await submit({ origin: ORIGIN })

    for (const response of [mismatched, taken]) {
      const location = response.headers.get('location') ?? ''
      expect(location).not.toContain('correct')
      expect(location).not.toContain('wrong')
      expect(location).not.toContain('password=')
    }
  })

  it('falls back to a generic error when sso-api cannot be reached', async () => {
    vi.mocked(registerUser).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const response = await submit({ origin: ORIGIN })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/register?error=1`)
  })
})
