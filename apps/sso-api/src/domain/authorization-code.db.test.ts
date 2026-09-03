import { createHash, randomBytes } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { authorizationCodes, users } from '../db/schema'
import { testDatabase, truncateAll } from '../test/database'
import { issueCode, redeemCode } from './authorization-code'
import { openSession, revokeSession, verifySession } from './session'

const { db, close } = testDatabase()
const CLIENT = 'harbor'
const REDIRECT = 'https://harbor.example/callback'

const verifier = () => randomBytes(32).toString('base64url')
const challengeFor = (v: string) => createHash('sha256').update(v).digest('base64url')

async function codeFor(overrides: { clientId?: string; redirectUri?: string } = {}) {
  const [user] = await db
    .insert(users)
    .values({ email: `c-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
    .returning({ id: users.id })

  const session = await openSession(db, user!.id)
  const verified = await verifySession(db, session.token)

  const secret = verifier()
  const issued = await issueCode(db, {
    clientId: overrides.clientId ?? CLIENT,
    redirectUri: overrides.redirectUri ?? REDIRECT,
    userId: user!.id,
    ssoSessionId: verified!.id,
    codeChallenge: challengeFor(secret),
  })

  return { ...issued, verifier: secret, userId: user!.id, sessionToken: session.token }
}

const redeem = (code: string, verifierValue: string, extra: Partial<{ clientId: string; redirectUri: string }> = {}) =>
  redeemCode(db, {
    code,
    clientId: extra.clientId ?? CLIENT,
    redirectUri: extra.redirectUri ?? REDIRECT,
    codeVerifier: verifierValue,
  })

beforeEach(async () => {
  await truncateAll(db)
})

afterAll(async () => {
  await close()
})

describe('an authorization code', () => {
  it('is redeemed once', async () => {
    const code = await codeFor()

    const first = await redeem(code.code, code.verifier)

    expect(first).toMatchObject({ redeemed: true, userId: code.userId })
  })

  it('lives sixty seconds', async () => {
    await codeFor()

    const [row] = await db
      .select({ seconds: sql<number>`extract(epoch from (expires_at - created_at))` })
      .from(authorizationCodes)

    expect(Number(row!.seconds)).toBe(60)
  })
})

/** ADR-0001 ②: a second presentation is an attack, not a retry. */
describe('a code presented twice', () => {
  it('is refused, and told apart from one that merely expired', async () => {
    const code = await codeFor()
    await redeem(code.code, code.verifier)

    expect(await redeem(code.code, code.verifier)).toEqual({
      redeemed: false,
      reason: 'replayed',
    })
  })

  it('cannot be redeemed twice even by two callers at once', async () => {
    const code = await codeFor()

    const results = await Promise.all([
      redeem(code.code, code.verifier),
      redeem(code.code, code.verifier),
    ])

    expect(results.filter((result) => result.redeemed)).toHaveLength(1)
    expect(results.filter((result) => !result.redeemed)[0]).toMatchObject({ reason: 'replayed' })
  })
})

describe('what a code is bound to', () => {
  it('refuses a wrong verifier, and spends the code doing it', async () => {
    const code = await codeFor()

    expect(await redeem(code.code, verifier())).toEqual({ redeemed: false, reason: 'mismatch' })

    // Spent regardless: leaving it live would let whoever holds it keep guessing.
    const [row] = await db
      .select({ consumedAt: authorizationCodes.consumedAt })
      .from(authorizationCodes)
    expect(row!.consumedAt).not.toBeNull()
  })

  it('refuses another client', async () => {
    const code = await codeFor()

    expect(await redeem(code.code, code.verifier, { clientId: 'beacon' })).toEqual({
      redeemed: false,
      reason: 'mismatch',
    })
  })

  it('refuses another redirect', async () => {
    const code = await codeFor()

    expect(
      await redeem(code.code, code.verifier, { redirectUri: 'https://harbor.example/elsewhere' }),
    ).toEqual({ redeemed: false, reason: 'mismatch' })
  })
})

/** ADR-0018's Consequences: bound to the session that produced it. */
describe('a code whose session was revoked before redemption', () => {
  it('is refused, and told apart from an expired one', async () => {
    const code = await codeFor()
    await revokeSession(db, code.sessionToken)

    expect(await redeem(code.code, code.verifier)).toEqual({
      redeemed: false,
      reason: 'revoked',
    })
  })

  it('is left unconsumed, unlike a wrong verifier', async () => {
    const code = await codeFor()
    await revokeSession(db, code.sessionToken)
    await redeem(code.code, code.verifier)

    const [row] = await db
      .select({ consumedAt: authorizationCodes.consumedAt })
      .from(authorizationCodes)
    expect(row!.consumedAt).toBeNull()
  })
})

describe('what is refused rather than treated as replay', () => {
  it('tells an expired code from a spent one', async () => {
    const code = await codeFor()
    await db
      .update(authorizationCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })

    expect(await redeem(code.code, code.verifier)).toEqual({
      redeemed: false,
      reason: 'expired',
    })
  })

  it.each([
    ['a refresh token', `trr_${'a'.repeat(43)}`],
    ['a code nobody issued', `trc_${'a'.repeat(43)}`],
  ])('refuses %s', async (_label, code) => {
    expect(await redeem(code, verifier())).toEqual({ redeemed: false, reason: 'unknown' })
  })
})
