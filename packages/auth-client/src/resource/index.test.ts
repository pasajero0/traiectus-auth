import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import { requirePrincipal, verifyAccessToken, type ResourceConfig } from './index'

/**
 * Written with nothing but jose and the web platform — no `node:crypto`, no `Buffer`. This
 * module has to run on any server, so its own tests are the first place that would slip.
 */
const ISSUER = 'https://sso.example'
const AUDIENCE = 'harbor'

type Identity = { privateJwk: Awaited<ReturnType<typeof exportJWK>>; publicJwk: string }

const mint = async (): Promise<Identity> => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  return {
    privateJwk: await exportJWK(privateKey),
    publicJwk: JSON.stringify(await exportJWK(publicKey)),
  }
}

let identity: Identity
let impostor: Identity
let config: ResourceConfig

beforeAll(async () => {
  identity = await mint()
  impostor = await mint()
  config = { issuer: ISSUER, audience: AUDIENCE, publicKey: identity.publicJwk }
})

async function accessToken(
  claims: { issuer?: string; audience?: string; subject?: string; expires?: string } = {},
  signWith?: Identity,
) {
  const key = await importJWK((signWith ?? identity).privateJwk, 'EdDSA')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? AUDIENCE)
    .setSubject(claims.subject ?? crypto.randomUUID())
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(claims.expires ?? '300s')
    .sign(key)
}

const base64url = (value: string) =>
  btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

describe('a token this API should accept', () => {
  it('yields the principal it was minted for', async () => {
    const userId = crypto.randomUUID()

    const result = await verifyAccessToken(config, await accessToken({ subject: userId }))

    expect(result).toMatchObject({ verified: true, principal: { userId, clientId: AUDIENCE } })
  })

  it('carries the expiry the resource server can act on', async () => {
    const result = await verifyAccessToken(config, await accessToken())

    if (!result.verified) throw new Error('expected a verified token')
    const secondsLeft = (result.principal.expiresAt.getTime() - Date.now()) / 1000
    expect(secondsLeft).toBeGreaterThan(290)
    expect(secondsLeft).toBeLessThanOrEqual(300)
  })
})

/**
 * Every product's token is signed by the same key, so `aud` is the only thing standing
 * between Beacon's token and Harbor's data.
 */
describe('a token minted for somebody else', () => {
  it('is refused for its audience', async () => {
    expect(await verifyAccessToken(config, await accessToken({ audience: 'beacon' }))).toEqual({
      verified: false,
      reason: 'wrong_audience',
    })
  })

  it('is refused for its issuer', async () => {
    const token = await accessToken({ issuer: 'https://not-traiectus.example' })

    expect(await verifyAccessToken(config, token)).toEqual({
      verified: false,
      reason: 'wrong_issuer',
    })
  })

  it('is refused when another key signed it', async () => {
    expect(await verifyAccessToken(config, await accessToken({}, impostor))).toEqual({
      verified: false,
      reason: 'signature',
    })
  })
})

describe('a token that is over', () => {
  it('is refused, and says so specifically', async () => {
    expect(await verifyAccessToken(config, await accessToken({ expires: '-1s' }))).toEqual({
      verified: false,
      reason: 'expired',
    })
  })
})

/** The attack the `algorithms` option exists for. */
describe('a token that announces another algorithm', () => {
  it('refuses HS256 signed with the public key as its secret', async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(crypto.randomUUID())
      .setExpirationTime('300s')
      .sign(new TextEncoder().encode(identity.publicJwk))

    expect(await verifyAccessToken(config, forged)).toEqual({
      verified: false,
      reason: 'algorithm',
    })
  })

  it('refuses an unsigned token', async () => {
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = base64url(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: crypto.randomUUID(), exp: 9999999999 }),
    )

    expect((await verifyAccessToken(config, `${header}.${payload}.`)).verified).toBe(false)
  })
})

describe('what is not a token at all', () => {
  it.each([
    ['nonsense', 'not-a-token'],
    ['an empty string', ''],
    ['an opaque refresh token', `trr_${'a'.repeat(43)}`],
  ])('refuses %s', async (_label, token) => {
    expect(await verifyAccessToken(config, token)).toEqual({
      verified: false,
      reason: 'malformed',
    })
  })
})

describe('the Authorization header', () => {
  it('accepts a bearer token', async () => {
    expect((await requirePrincipal(config, `Bearer ${await accessToken()}`)).verified).toBe(true)
  })

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['a bearer with nothing after it', 'Bearer '],
    ['basic credentials', 'Basic aGFyYm9yOnNlY3JldA=='],
    ['a bare token with no scheme', 'eyJhbGciOiJFZERTQSJ9.e30.'],
  ])('refuses %s', async (_label, header) => {
    expect(await requirePrincipal(config, header)).toEqual({
      verified: false,
      reason: 'malformed',
    })
  })
})

/** A deployment mistake worth catching loudly: the private key pasted where the public goes. */
describe('the configured key', () => {
  it('refuses a private key', async () => {
    const wrong = { ...config, publicKey: JSON.stringify(identity.privateJwk) }

    await expect(verifyAccessToken(wrong, await accessToken())).rejects.toThrow(/private key/)
  })

  it('refuses something that is not a JWK', async () => {
    const wrong = { ...config, publicKey: 'not json' }

    await expect(verifyAccessToken(wrong, await accessToken())).rejects.toThrow(/one-line JWK/)
  })
})
