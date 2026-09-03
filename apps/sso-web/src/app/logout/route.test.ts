import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

vi.mock('@/server/session', () => ({ readSessionCookie: vi.fn(), SSO_COOKIE_NAME: 'traiectus_sso' }))
vi.mock('@/server/sso-api', () => ({ revokeSession: vi.fn() }))

const { readSessionCookie } = await import('@/server/session')
const { revokeSession } = await import('@/server/sso-api')

const ORIGIN = 'http://localhost:4100'

const logout = (headers: Record<string, string> = {}) =>
  POST(new Request(`${ORIGIN}/logout`, { method: 'POST', headers }))

beforeEach(() => {
  vi.resetAllMocks()
  process.env['SSO_WEB_URL'] = ORIGIN
  process.env['SSO_API_URL'] = 'http://localhost:4000'
  process.env['INTERNAL_API_KEY'] = 'test-internal-key'
})

/** The check that holds the CSRF surface closed — it runs before anything else. */
describe('the Origin check', () => {
  it('refuses a request carrying no Origin', async () => {
    const response = await logout()

    expect(response.status).toBe(403)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('refuses a request from another site', async () => {
    const response = await logout({ origin: 'https://not-traiectus.example' })

    expect(response.status).toBe(403)
    expect(revokeSession).not.toHaveBeenCalled()
  })
})

describe('signing out', () => {
  it('revokes the session, clears the cookie, and returns to /', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('trs_live')

    const response = await logout({ origin: ORIGIN })

    expect(revokeSession).toHaveBeenCalledWith('trs_live')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`)
    expect(response.headers.get('set-cookie')).toContain('traiectus_sso=;')
  })

  it('still clears the cookie when there was no session to revoke', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue(null)

    const response = await logout({ origin: ORIGIN })

    expect(revokeSession).not.toHaveBeenCalled()
    expect(response.status).toBe(303)
  })
})
