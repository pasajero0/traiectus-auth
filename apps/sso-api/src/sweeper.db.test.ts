import { randomBytes, randomUUID } from 'node:crypto'

import { type SQL, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from './db/client'
import { authorizationCodes, refreshFamilies, refreshTokens, ssoSessions, users } from './db/schema'
import { maybeSweep, resetSweepGate, sweepAll } from './sweeper'
import { testDatabase, truncateAll } from './test/database'

const { db, close } = testDatabase()
const hex = () => randomBytes(16).toString('hex')

async function aUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `s-${hex()}@example.com`, passwordHash: 'x' })
    .returning({ id: users.id })
  return user!.id
}

async function aSession(userId: string, opts: { expiresAt?: SQL; revokedAt?: SQL } = {}) {
  const [session] = await db
    .insert(ssoSessions)
    .values({
      tokenHash: hex(),
      userId,
      expiresAt: opts.expiresAt ?? sql`now() + interval '1 day'`,
      ...(opts.revokedAt ? { revokedAt: opts.revokedAt } : {}),
    })
    .returning({ id: ssoSessions.id })
  return session!.id
}

async function aFamily(userId: string, opts: { expiresAt?: SQL; revokedAt?: SQL } = {}) {
  const [family] = await db
    .insert(refreshFamilies)
    .values({
      userId,
      clientId: 'harbor',
      expiresAt: opts.expiresAt ?? sql`now() + interval '1 day'`,
      ...(opts.revokedAt ? { revokedAt: opts.revokedAt } : {}),
    })
    .returning({ id: refreshFamilies.id })
  return family!.id
}

async function aToken(
  familyId: string,
  opts: { expiresAt?: SQL; consumedAt?: SQL; replayUntil?: SQL; successorCiphertext?: string } = {},
) {
  const [token] = await db
    .insert(refreshTokens)
    .values({
      id: randomUUID(),
      familyId,
      tokenHash: hex(),
      expiresAt: opts.expiresAt ?? sql`now() + interval '1 day'`,
      ...(opts.consumedAt ? { consumedAt: opts.consumedAt } : {}),
      ...(opts.replayUntil ? { replayUntil: opts.replayUntil } : {}),
      ...(opts.successorCiphertext ? { successorCiphertext: opts.successorCiphertext } : {}),
    })
    .returning({ id: refreshTokens.id })
  return token!.id
}

async function aCode(
  userId: string,
  sessionId: string,
  opts: { expiresAt?: SQL; consumedAt?: SQL } = {},
) {
  const [code] = await db
    .insert(authorizationCodes)
    .values({
      codeHash: hex(),
      clientId: 'harbor',
      redirectUri: 'https://harbor.example/callback',
      userId,
      ssoSessionId: sessionId,
      codeChallenge: hex(),
      expiresAt: opts.expiresAt ?? sql`now() + interval '1 day'`,
      ...(opts.consumedAt ? { consumedAt: opts.consumedAt } : {}),
    })
    .returning({ id: authorizationCodes.id })
  return code!.id
}

const eightDaysAgo = sql`now() - interval '8 days'`
const sixDaysAgo = sql`now() - interval '6 days'`

beforeEach(async () => {
  resetSweepGate()
  await truncateAll(db)
})

afterAll(async () => {
  await close()
})

const survives = async (
  table: typeof ssoSessions | typeof refreshFamilies | typeof refreshTokens | typeof authorizationCodes,
  id: string,
) => {
  const [row] = await db.select({ id: table.id }).from(table as typeof ssoSessions).where(eq(table.id, id))
  return row !== undefined
}

describe('sweeping sso_sessions', () => {
  it('collects a session a week past hard expiry', async () => {
    const id = await aSession(await aUser(), { expiresAt: eightDaysAgo })
    await sweepAll(db)
    expect(await survives(ssoSessions, id)).toBe(false)
  })

  it('collects a session a week past revocation, even with time left on its expiry', async () => {
    const id = await aSession(await aUser(), { revokedAt: eightDaysAgo })
    await sweepAll(db)
    expect(await survives(ssoSessions, id)).toBe(false)
  })

  it('leaves a session revoked less than a week ago', async () => {
    const id = await aSession(await aUser(), { revokedAt: sixDaysAgo })
    await sweepAll(db)
    expect(await survives(ssoSessions, id)).toBe(true)
  })

  it('leaves a live session alone', async () => {
    const id = await aSession(await aUser())
    await sweepAll(db)
    expect(await survives(ssoSessions, id)).toBe(true)
  })
})

describe('sweeping refresh_tokens and refresh_families', () => {
  it('collects a token consumed a week ago even though its family is still alive', async () => {
    const family = await aFamily(await aUser())
    const token = await aToken(family, { consumedAt: eightDaysAgo })

    await sweepAll(db)

    expect(await survives(refreshTokens, token)).toBe(false)
    expect(await survives(refreshFamilies, family)).toBe(true)
  })

  it('leaves a token consumed less than a week ago', async () => {
    const family = await aFamily(await aUser())
    const token = await aToken(family, { consumedAt: sixDaysAgo })

    await sweepAll(db)

    expect(await survives(refreshTokens, token)).toBe(true)
  })

  it('collects a revoked family and cascades whatever token is still attached', async () => {
    const family = await aFamily(await aUser(), { revokedAt: eightDaysAgo })
    const token = await aToken(family)

    await sweepAll(db)

    expect(await survives(refreshFamilies, family)).toBe(false)
    expect(await survives(refreshTokens, token)).toBe(false)
  })

  it('wipes a closed replay window without deleting the row', async () => {
    const family = await aFamily(await aUser())
    const token = await aToken(family, {
      replayUntil: sql`now() - interval '1 minute'`,
      successorCiphertext: 'ciphertext',
    })

    await sweepAll(db)

    const [row] = await db
      .select({ successorCiphertext: refreshTokens.successorCiphertext })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, token))
    expect(row!.successorCiphertext).toBeNull()
    expect(await survives(refreshTokens, token)).toBe(true)
  })
})

describe('sweeping authorization_codes', () => {
  it('collects a code a week past its sixty-second expiry', async () => {
    const userId = await aUser()
    const sessionId = await aSession(userId)
    const id = await aCode(userId, sessionId, { expiresAt: eightDaysAgo })

    await sweepAll(db)

    expect(await survives(authorizationCodes, id)).toBe(false)
  })

  it('collects a code consumed a week ago, ahead of its own expiry', async () => {
    const userId = await aUser()
    const sessionId = await aSession(userId)
    const id = await aCode(userId, sessionId, { consumedAt: eightDaysAgo })

    await sweepAll(db)

    expect(await survives(authorizationCodes, id)).toBe(false)
  })

  it('leaves a fresh, unconsumed code alone', async () => {
    const userId = await aUser()
    const sessionId = await aSession(userId)
    const id = await aCode(userId, sessionId)

    await sweepAll(db)

    expect(await survives(authorizationCodes, id)).toBe(true)
  })
})

/** ADR-0015: at most once an hour, and a failure is retried next hour rather than sooner. */
describe('the throttle gate', () => {
  it('sweeps once resetSweepGate makes it eligible, and skips the very next call', async () => {
    const id = await aSession(await aUser(), { expiresAt: eightDaysAgo })

    await maybeSweep(db, { error: () => undefined })
    expect(await survives(ssoSessions, id)).toBe(false)

    const secondGarbage = await aSession(await aUser(), { expiresAt: eightDaysAgo })
    const started = maybeSweep(db, { error: () => undefined })
    expect(started).toBeUndefined()
    expect(await survives(ssoSessions, secondGarbage)).toBe(true)
  })

  it('logs and swallows a failure rather than throwing at the caller', async () => {
    resetSweepGate()
    const errors: unknown[] = []
    const broken = {
      delete: () => {
        throw new Error('nope')
      },
    } as unknown as Database

    await maybeSweep(broken, { error: (payload) => errors.push(payload) })

    expect(errors).toHaveLength(1)
  })
})
