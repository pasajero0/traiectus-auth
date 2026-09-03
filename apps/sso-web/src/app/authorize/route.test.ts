import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

vi.mock('@/server/session', () => ({ readSessionCookie: vi.fn() }))
vi.mock('@/server/sso-api', () => ({ issueCode: vi.fn() }))

const { readSessionCookie } = await import('@/server/session')
const { issueCode } = await import('@/server/sso-api')

const ORIGIN = 'http://localhost:4100'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const QUERY =
  'client_id=harbor&redirect_uri=https%3A%2F%2Fharbor.example%2Fcallback&response_type=code' +
  `&state=xyz&code_challenge=${CHALLENGE}&code_challenge_method=S256`

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
    expect(issueCode).not.toHaveBeenCalled()
  })

  it('hands a live session back to the client with a code, its state and the issuer', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('trs_live')
    vi.mocked(issueCode).mockResolvedValue({
      issued: true,
      code: 'trc_a-code',
      expiresAt: new Date().toISOString(),
    })

    const response = await authorize()
    const back = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(back.origin + back.pathname).toBe('https://harbor.example/callback')
    expect(back.searchParams.get('code')).toBe('trc_a-code')
    expect(back.searchParams.get('state')).toBe('xyz')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
  })

  it('sends a browser whose session has expired to sign in as well', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('trs_stale')
    vi.mocked(issueCode).mockResolvedValue({ issued: false, reason: 'no_session' })

    expect((await authorize()).status).toBe(302)
  })

  /** The refusal that must not travel: anything sent to an unregistered address confirms it. */
  it.each([['an unregistered client', 'unknown_client'], ['a redirect nobody registered', 'redirect_not_allowed']])(
    'refuses %s on our own page, without redirecting',
    async (_label, reason) => {
      vi.mocked(readSessionCookie).mockResolvedValue('trs_live')
      vi.mocked(issueCode).mockResolvedValue({ issued: false, reason: reason as 'unknown_client' })

      const response = await authorize()

      expect(response.status).toBe(400)
      expect(response.headers.get('location')).toBeNull()
    },
  )

  it('treats an unreachable sso-api as no session rather than as an error page', async () => {
    vi.mocked(readSessionCookie).mockResolvedValue('trs_live')
    vi.mocked(issueCode).mockRejectedValue(new Error('connect ECONNREFUSED'))

    expect((await authorize()).status).toBe(302)
  })

  it.each([
    ['no PKCE challenge at all', 'client_id=harbor&redirect_uri=https%3A%2F%2Fharbor.example%2Fcallback&response_type=code'],
    ['a plain challenge method', QUERY.replace('S256', 'plain')],
  ])('refuses a request with %s', async (_label, query) => {
    vi.mocked(readSessionCookie).mockResolvedValue(null)

    expect((await authorize(query)).status).toBe(400)
    expect(readSessionCookie).not.toHaveBeenCalled()
  })
})
