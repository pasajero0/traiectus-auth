import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

vi.mock('@traiectus/auth-client/server', () => ({
  signOut: vi.fn(() => ({ clearSession: true })),
}))

const ORIGIN = 'http://localhost:3000'
const SSO_WEB_URL = 'http://localhost:4100'

const logout = (headers: Record<string, string> = {}) =>
  POST(new Request(`${ORIGIN}/api/auth/logout`, { method: 'POST', headers }), {
    params: Promise.resolve({ traiectus: ['logout'] }),
  })

beforeEach(() => {
  process.env['APP_BASE_URL'] = ORIGIN
  process.env['SSO_WEB_URL'] = SSO_WEB_URL
  process.env['SSO_API_URL'] = 'http://localhost:4000'
  process.env['TRAIECTUS_CLIENT_ID'] = 'harbor'
  process.env['TRAIECTUS_CLIENT_SECRET'] = 'a-client-secret-of-adequate-length'
  process.env['SESSION_SEAL_KEY'] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  process.env['HARBOR_API_URL'] = 'http://localhost:3100'
})

describe('the Origin check', () => {
  it('refuses a request carrying no Origin', async () => {
    expect((await logout()).status).toBe(403)
  })

  it('refuses a request from another site', async () => {
    expect((await logout({ origin: 'https://not-harbor.example' })).status).toBe(403)
  })
})

/**
 * Leaving this product is not the same as leaving the identity layer — the SSO session
 * stays alive, and the hub is a more useful landing than a bare login form. ADR-0020.
 */
describe('signing out', () => {
  it('clears the local cookie and sends the browser to the hub, session intact', async () => {
    const response = await logout({ origin: ORIGIN })
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(303)
    expect(location.origin).toBe(SSO_WEB_URL)
    expect(location.pathname).toBe('/')
    expect(response.headers.get('set-cookie')).toContain('harbor_session=;')
  })
})
