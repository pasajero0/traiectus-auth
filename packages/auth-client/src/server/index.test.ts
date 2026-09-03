import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { open, seal, sessionSchema, transactionSchema } from './envelope'
import {
  bearerFor,
  completeSignIn,
  refresh,
  startSignIn,
  type AuthClientConfig,
} from './index'

const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const config: AuthClientConfig = {
  ssoWebUrl: 'https://sso.example',
  ssoApiUrl: 'https://sso-api.example',
  clientId: 'harbor',
  clientSecret: 'a-client-secret-of-adequate-length',
  redirectUri: 'https://harbor.example/api/auth/callback',
  sealKey: base64(crypto.getRandomValues(new Uint8Array(32))),
}

const pair = (expiresIn = 300) => ({
  access_token: 'an-access-token',
  token_type: 'Bearer',
  expires_in: expiresIn,
  refresh_token: 'trr_a-refresh-token',
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(pair()), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sealed envelope', () => {
  it('comes back out under the same key', async () => {
    const sealed = await seal(config.sealKey, {
      state: 's',
      codeVerifier: 'v',
      returnTo: '/dashboard',
      expiresAt: Date.now() + 1000,
    })

    expect(await open(config.sealKey, sealed, transactionSchema)).toMatchObject({
      returnTo: '/dashboard',
    })
  })

  it('does not leave the tokens legible', async () => {
    const sealed = await seal(config.sealKey, {
      accessToken: 'an-access-token',
      accessExpiresAt: Date.now(),
      refreshToken: 'trr_secret',
    })

    expect(sealed).not.toContain('trr_secret')
    expect(sealed).not.toContain('an-access-token')
  })

  it.each([
    ['another key', async () => base64(crypto.getRandomValues(new Uint8Array(32)))],
  ])('refuses %s', async (_label, otherKey) => {
    const sealed = await seal(config.sealKey, { state: 's', codeVerifier: 'v', returnTo: '/', expiresAt: 1 })

    expect(await open(await otherKey(), sealed, transactionSchema)).toBeNull()
  })

  it('refuses an envelope that was edited', async () => {
    const sealed = await seal(config.sealKey, { state: 's', codeVerifier: 'v', returnTo: '/', expiresAt: 1 })
    const edited = `${sealed.slice(0, -2)}${sealed.endsWith('a') ? 'b' : 'a'}=`

    expect(await open(config.sealKey, edited, transactionSchema)).toBeNull()
  })

  it.each([
    ['nothing', undefined],
    ['an unversioned string', 'not-an-envelope'],
    ['a future format', 't2.abcdef'],
  ])('refuses %s', async (_label, value) => {
    expect(await open(config.sealKey, value, transactionSchema)).toBeNull()
  })

  it('refuses a seal key that is not thirty-two bytes', async () => {
    await expect(seal(base64(new Uint8Array(16)), {})).rejects.toThrow(/32 bytes/)
  })
})

describe('starting a sign-in', () => {
  it('asks for a code with PKCE, and keeps the verifier sealed', async () => {
    const started = await startSignIn(config, '/dashboard')
    const url = new URL(started.url)

    expect(url.origin + url.pathname).toBe('https://sso.example/authorize')
    expect(url.searchParams.get('client_id')).toBe('harbor')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const transaction = await open(config.sealKey, started.transaction, transactionSchema)
    expect(transaction).toMatchObject({ returnTo: '/dashboard' })
    expect(url.searchParams.get('state')).toBe(transaction!.state)

    // The challenge on the wire is the digest of the verifier that never left this server.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(transaction!.codeVerifier),
    )
    const expected = base64(new Uint8Array(digest))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
    expect(url.searchParams.get('code_challenge')).toBe(expected)
  })

  it('never starts two transactions alike', async () => {
    const first = await open(config.sealKey, (await startSignIn(config)).transaction, transactionSchema)
    const second = await open(config.sealKey, (await startSignIn(config)).transaction, transactionSchema)

    expect(first!.state).not.toBe(second!.state)
    expect(first!.codeVerifier).not.toBe(second!.codeVerifier)
  })
})

const callbackFor = async (
  overrides: Partial<{ state: string; iss: string | null; code: string | null }> = {},
) => {
  const started = await startSignIn(config, '/dashboard')
  const transaction = await open(config.sealKey, started.transaction, transactionSchema)

  const params = new URLSearchParams()
  if (overrides.code !== null) params.set('code', overrides.code ?? 'trc_a-code')
  params.set('state', overrides.state ?? transaction!.state)
  if (overrides.iss !== null) params.set('iss', overrides.iss ?? 'https://sso.example')

  return { params, transaction: started.transaction, codeVerifier: transaction!.codeVerifier }
}

describe('completing a sign-in', () => {
  it('exchanges the code and seals the pair', async () => {
    const callback = await callbackFor()

    const result = await completeSignIn(config, callback)

    expect(result).toMatchObject({ signedIn: true, returnTo: '/dashboard' })
    if (!result.signedIn) return

    expect(await open(config.sealKey, result.session, sessionSchema)).toMatchObject({
      accessToken: 'an-access-token',
      refreshToken: 'trr_a-refresh-token',
    })
  })

  it('sends the verifier, the client credentials and a form', async () => {
    const callback = await callbackFor()

    await completeSignIn(config, callback)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sso-api.example/v1/token')
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      `Basic ${btoa('harbor:a-client-secret-of-adequate-length')}`,
    )
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    )

    const sent = init.body as URLSearchParams
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code_verifier')).toBe(callback.codeVerifier)
    expect(sent.get('redirect_uri')).toBe(config.redirectUri)
  })

  /** ADR-0017: absent is a failure, because a check that skips can be skipped. */
  it.each([
    ['no iss at all', { iss: null }],
    ['an iss from somewhere else', { iss: 'https://not-traiectus.example' }],
  ])('refuses a response with %s', async (_label, overrides) => {
    const callback = await callbackFor(overrides)

    expect(await completeSignIn(config, callback)).toEqual({
      signedIn: false,
      reason: 'wrong_issuer',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a state that does not match the one it started', async () => {
    const callback = await callbackFor({ state: 'somebody-elses-state' })

    expect(await completeSignIn(config, callback)).toEqual({
      signedIn: false,
      reason: 'state_mismatch',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['no transaction cookie', undefined],
    ['a transaction cookie it cannot open', 't1.YWJjZGVm'],
  ])('refuses a callback with %s', async (_label, transaction) => {
    const callback = await callbackFor()

    expect(await completeSignIn(config, { params: callback.params, transaction })).toEqual({
      signedIn: false,
      reason: 'no_transaction',
    })
  })

  it('refuses a transaction that has expired', async () => {
    const stale = await seal(config.sealKey, {
      state: 'a-state',
      codeVerifier: 'a-verifier',
      returnTo: '/',
      expiresAt: Date.now() - 1000,
    })
    const params = new URLSearchParams({ code: 'trc_x', state: 'a-state', iss: 'https://sso.example' })

    expect(await completeSignIn(config, { params, transaction: stale })).toEqual({
      signedIn: false,
      reason: 'no_transaction',
    })
  })

  it('refuses a response carrying no code', async () => {
    const callback = await callbackFor({ code: null })

    expect(await completeSignIn(config, callback)).toEqual({
      signedIn: false,
      reason: 'authorization_failed',
    })
  })

  it('refuses when the token endpoint does', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    )
    const callback = await callbackFor()

    expect(await completeSignIn(config, callback)).toEqual({
      signedIn: false,
      reason: 'exchange_failed',
    })
  })
})

describe('the bearer for one outbound call', () => {
  const sessionWith = (secondsLeft: number) =>
    seal(config.sealKey, {
      accessToken: 'a-live-token',
      accessExpiresAt: Date.now() + secondsLeft * 1000,
      refreshToken: `trr_${secondsLeft}`,
    })

  it('hands over the token it has, and rotates nothing', async () => {
    const result = await bearerFor(config, await sessionWith(120))

    expect(result).toEqual({ token: 'a-live-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes early rather than after a refusal', async () => {
    const result = await bearerFor(config, await sessionWith(20))

    expect(result?.token).toBe('an-access-token')
    // A new envelope came back, which is the caller's cue to rewrite the cookie.
    expect(result?.session).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The sharing exists only while a rotation is genuinely in flight, so the mock takes a
   * tick the way a round trip does. With an instant answer there is nothing to share, and
   * both callers rotate — which is correct, and is why ADR-0009 ③ calls this a reduction
   * rather than a guarantee.
   */
  it('shares one rotation between concurrent calls on the same instance', async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((resume) => setTimeout(resume, 5))
      return new Response(JSON.stringify(pair()), { status: 200 })
    })
    const envelope = await sessionWith(5)

    const [first, second] = await Promise.all([
      bearerFor(config, envelope),
      bearerFor(config, envelope),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first?.token).toBe(second?.token)
  })

  it('gives nothing for an envelope it cannot open', async () => {
    expect(await bearerFor(config, 't1.bm90LXJlYWw')).toBeNull()
  })
})

describe('refreshing on purpose', () => {
  it('answers a new envelope', async () => {
    const envelope = await seal(config.sealKey, {
      accessToken: 'old',
      accessExpiresAt: Date.now() + 60_000,
      refreshToken: 'trr_deliberate',
    })

    const result = await refresh(config, envelope)

    expect(result.refreshed).toBe(true)
  })

  it.each([
    ['there is no session', undefined, 'no_session'],
  ])('refuses when %s', async (_label, envelope, reason) => {
    expect(await refresh(config, envelope)).toEqual({ refreshed: false, reason })
  })

  it('refuses when the family is gone', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    )
    const envelope = await seal(config.sealKey, {
      accessToken: 'old',
      accessExpiresAt: Date.now(),
      refreshToken: 'trr_revoked',
    })

    expect(await refresh(config, envelope)).toEqual({
      refreshed: false,
      reason: 'rotation_refused',
    })
  })
})
