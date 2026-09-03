import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from './app.js'
import type { Env } from './env.js'

/** No node:crypto, no Buffer — the same reason auth-client's own tests avoid them. */
const ISSUER = 'https://sso.example'

let env: Env
let identity: { privateJwk: Awaited<ReturnType<typeof exportJWK>>; publicJwk: string }
let impostor: { privateJwk: Awaited<ReturnType<typeof exportJWK>> }

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  identity = { privateJwk: await exportJWK(privateKey), publicJwk: JSON.stringify(await exportJWK(publicKey)) }

  const other = await generateKeyPair('EdDSA', { extractable: true })
  impostor = { privateJwk: await exportJWK(other.privateKey) }

  env = {
    NODE_ENV: 'test',
    PORT: 3101,
    ACCESS_TOKEN_PUBLIC_KEY: identity.publicJwk,
    ISSUER,
  }
})

async function accessToken(
  claims: { audience?: string; expires?: string; issuer?: string } = {},
  signWith = identity.privateJwk,
) {
  const key = await importJWK(signWith, 'EdDSA')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? 'beacon')
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(claims.expires ?? '300s')
    .sign(key)
}

describe('GET /health', () => {
  it('answers with no token at all', async () => {
    const response = await buildApp(env).request('/health')

    expect(response.status).toBe(200)
  })
})

/** ADR-0007: the audience is a property of the router, checked before any handler runs. */
describe('GET /v1/messages', () => {
  it('refuses a request with no Authorization header', async () => {
    const response = await buildApp(env).request('/v1/messages')

    expect(response.status).toBe(401)
  })

  it.each([
    ['a header that is not Bearer', 'Basic aGFyYm9yOnNlY3JldA=='],
    ['a bearer with nothing after it', 'Bearer '],
    ['nonsense', 'Bearer not-a-token'],
  ])('refuses %s', async (_label, authorization) => {
    const response = await buildApp(env).request('/v1/messages', { headers: { authorization } })

    expect(response.status).toBe(401)
  })

  /** Every product's token is signed by the same key; aud is what tells them apart. */
  it('refuses a token minted for another product', async () => {
    const token = await accessToken({ audience: 'harbor' })

    const response = await buildApp(env).request('/v1/messages', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(401)
  })

  it('refuses a token from another issuer', async () => {
    const token = await accessToken({ issuer: 'https://not-traiectus.example' })

    const response = await buildApp(env).request('/v1/messages', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(401)
  })

  it('refuses an expired token', async () => {
    const token = await accessToken({ expires: '-1s' })

    const response = await buildApp(env).request('/v1/messages', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(401)
  })

  it('refuses a token signed by another key', async () => {
    const token = await accessToken({}, impostor.privateJwk)

    const response = await buildApp(env).request('/v1/messages', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(401)
  })

  it('answers a verified caller', async () => {
    const token = await accessToken()

    const response = await buildApp(env).request('/v1/messages', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ messages: [] })
  })
})
