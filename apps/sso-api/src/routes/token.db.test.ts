import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { resetClients } from '../clients'
import { refreshFamilies, users } from '../db/schema'
import { issueCode } from '../domain/authorization-code'
import { openSession, verifySession } from '../domain/session'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'
import { testDatabase, testEnv, truncateAll } from '../test/database'

const { db, close } = testDatabase()

const CLIENT = { id: 'harbor', secret: randomBytes(32).toString('base64url') }
const REDIRECT = 'https://harbor.example/callback'
const ISSUER = 'https://sso.example'

const { privateKey } = generateKeyPairSync('ed25519')
const jwk = privateKey.export({ format: 'jwk' })

const env = () =>
  testEnv({
    ISSUER,
    ACCESS_TOKEN_PRIVATE_KEY: JSON.stringify(jwk),
    REFRESH_SUCCESSOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    CLIENTS: JSON.stringify([{ ...CLIENT, redirectUris: [REDIRECT] }]),
  })

const basic = (secret = CLIENT.secret) =>
  `Basic ${Buffer.from(`${CLIENT.id}:${secret}`).toString('base64')}`

let app: Awaited<ReturnType<typeof buildServer>>

/** Form-encoded, as RFC 6749 §4.1.3 specifies and as a stranger's client would send. */
const post = (body: Record<string, string>, authorization = basic()) =>
  app.inject({
    method: 'POST',
    url: '/v1/token',
    headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  })

async function aCodeFor() {
  const [user] = await db
    .insert(users)
    .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
    .returning({ id: users.id })

  const session = await openSession(db, user!.id)
  const verified = await verifySession(db, session.token)
  const codeVerifier = randomBytes(32).toString('base64url')

  const issued = await issueCode(db, {
    clientId: CLIENT.id,
    redirectUri: REDIRECT,
    userId: user!.id,
    ssoSessionId: verified!.id,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
  })

  return { ...issued, codeVerifier, userId: user!.id }
}

const exchange = (code: string, codeVerifier: string) =>
  post({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: codeVerifier,
  })

beforeEach(async () => {
  resetRouteTable()
  resetClients()
  await truncateAll(db)
  app = await buildServer(env(), db)
  await app.ready()
})

afterAll(async () => {
  await close()
})

/** ADR-0007: the audience is the route's own property, not a check inside the handler. */
describe('who may call the token endpoint', () => {
  it('refuses a caller with no credentials', async () => {
    const response = await post({ grant_type: 'refresh_token', refresh_token: 'trr_x' }, '')

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toContain('Basic')
  })

  it.each([
    ['a wrong secret', () => basic('not-the-secret')],
    ['a client nobody registered', () => `Basic ${Buffer.from('stranger:secret').toString('base64')}`],
    ['a header that is not Basic', () => 'Bearer something'],
  ])('refuses %s', async (_label, authorization) => {
    const response = await post(
      { grant_type: 'refresh_token', refresh_token: 'trr_x' },
      authorization(),
    )

    expect(response.statusCode).toBe(401)
  })
})

describe('the authorization_code grant', () => {
  it('answers a pair, and the access token verifies against the public half alone', async () => {
    const code = await aCodeFor()

    const response = await exchange(code.code, code.codeVerifier)
    const body = response.json()

    expect(response.statusCode).toBe(200)
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(300)
    expect(body.refresh_token).toMatch(/^trr_/)

    const [header, payload, signature] = String(body.access_token).split('.')
    const publicKey = createPublicKey({ format: 'jwk', key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } })

    expect(
      verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature!, 'base64url')),
    ).toBe(true)

    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    expect(claims).toMatchObject({ iss: ISSUER, aud: CLIENT.id, sub: code.userId })
    expect(claims.jti).toBeTruthy()
  })

  it('refuses the same code a second time', async () => {
    const code = await aCodeFor()
    await exchange(code.code, code.codeVerifier)

    const again = await exchange(code.code, code.codeVerifier)

    expect(again.statusCode).toBe(400)
    expect(again.json()).toEqual({ error: 'invalid_grant' })
  })

  it('refuses a wrong verifier', async () => {
    const code = await aCodeFor()

    const response = await exchange(code.code, randomBytes(32).toString('base64url'))

    expect(response.statusCode).toBe(400)
  })

  it('refuses a redirect the code was not bound to', async () => {
    const code = await aCodeFor()

    const response = await post({
      grant_type: 'authorization_code',
      code: code.code,
      redirect_uri: 'https://harbor.example/elsewhere',
      code_verifier: code.codeVerifier,
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('the refresh_token grant', () => {
  it('rotates, and the successor works in its turn', async () => {
    const code = await aCodeFor()
    const first = (await exchange(code.code, code.codeVerifier)).json()

    const rotated = await post({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
    const second = rotated.json()

    expect(rotated.statusCode).toBe(200)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(second.access_token).not.toBe(first.access_token)

    const third = await post({ grant_type: 'refresh_token', refresh_token: second.refresh_token })
    expect(third.statusCode).toBe(200)
  })

  /** The exhibit. A token spent outside the window is the only evidence of theft there is. */
  it('revokes the family when a spent token comes back outside the window', async () => {
    const code = await aCodeFor()
    const first = (await exchange(code.code, code.codeVerifier)).json()
    await post({ grant_type: 'refresh_token', refresh_token: first.refresh_token })

    await db.execute(sql`
      update refresh_tokens
         set consumed_at = now() - interval '1 hour', replay_until = now() - interval '1 hour'
       where consumed_at is not null
    `)

    const reused = await post({ grant_type: 'refresh_token', refresh_token: first.refresh_token })

    expect(reused.statusCode).toBe(400)
    expect(reused.json()).toEqual({ error: 'invalid_grant' })

    const [family] = await db.select({ revokedAt: refreshFamilies.revokedAt }).from(refreshFamilies)
    expect(family!.revokedAt).not.toBeNull()
  })

  it('refuses a token of another kind', async () => {
    const response = await post({
      grant_type: 'refresh_token',
      refresh_token: `trs_${'a'.repeat(43)}`,
    })

    expect(response.statusCode).toBe(400)
  })
})
