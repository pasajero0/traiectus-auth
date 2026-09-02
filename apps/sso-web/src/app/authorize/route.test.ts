import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

vi.mock('@/server/session', () => ({ readSessionCookie: vi.fn() }))
vi.mock('@/server/sso-api', () => ({ verifySession: vi.fn() }))

const { readSessionCookie } = await import('@/server/session')
const { verifySession } = await import('@/server/sso-api')

const ORIGIN = 'http://localhost:4100'
const QUERY = 'client_id=harbor&redirect_uri=https%3A%2F%2Fharbor.example%2Fcallback&response_type=code'

const authorize = (query = QUERY) => GET(new Request(`${ORIGIN}/authorize?${query}`))

beforeEach(() => {
  vi.resetAllMocks()
  process.env['SSO_WEB_URL'] = ORIGIN
  process.env['SSO_API_URL'] = 'http://localhost:4000'
  process.env['INTERNAL_API_KEY'] = 'test-internal-key'
})

describe('GET /authorize', () => {
  it('sends a browser with no session to sign in, and remembers where it was going', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue(null)

    const response = await authorize()
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe(`/authorize?${QUERY}`)
    expect(verifySession).not.toHaveBeenCalled()
  })

  it('sends a browser whose session has expired to sign in as well', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('a-stale-token')
    vi.mocked(verifySession).mockResolvedValue({ verified: false })

    expect((await authorize()).status).toBe(302)
  })

  it('recognises a live session without showing a form', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('a-live-token')
    vi.mocked(verifySession).mockResolvedValue({
      verified: true,
      userId: 'a-user-id',
      expiresAt: new Date().toISOString(),
    })

    const response = await authorize()

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('treats an unreachable sso-api as no session rather than as an error page', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('a-token')
    vi.mocked(verifySession).mockRejectedValue(new Error('connect ECONNREFUSED'))

    expect((await authorize()).status).toBe(302)
  })

  it('refuses a request that is not an authorization request', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue(null)

    expect((await authorize('client_id=harbor')).status).toBe(400)
    expect(readSessionCookie).not.toHaveBeenCalled()
  })
})
