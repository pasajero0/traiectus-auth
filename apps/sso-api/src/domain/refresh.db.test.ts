import { randomBytes } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { refreshFamilies, users } from '../db/schema'
import { testDatabase, truncateAll } from '../test/database'
import { openFamily, revokeFamiliesForUser, revokeFamily, rotateRefreshToken } from './refresh'

/**
 * The claim this project is built to demonstrate, tested where it can actually fail. A race
 * lives in the database, so a test that does not reach the database cannot see one.
 */
const { db, close } = testDatabase()
const key = randomBytes(32)
const CLIENT = 'harbor'

const signIn = async (clientId = CLIENT) => {
  const [user] = await db
    .insert(users)
    .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
    .returning({ id: users.id })

  return openFamily(db, { userId: user!.id, clientId })
}

const rotate = (token: string, clientId = CLIENT) =>
  rotateRefreshToken(db, key, { token, clientId })

/** The clock is moved in the database, never in this process — see domain/lifetimes.ts. */
const spendLongAgo = (familyId: string) =>
  db.execute(sql`
    update refresh_tokens
       set consumed_at = now() - interval '1 hour', replay_until = now() - interval '1 hour'
     where family_id = ${familyId} and consumed_at is not null
  `)

beforeEach(async () => {
  await truncateAll(db)
})

afterAll(async () => {
  await close()
})

describe('rotation', () => {
  it('issues a new token and accepts it in turn', async () => {
    const family = await signIn()

    const first = await rotate(family.token)
    expect(first.outcome).toBe('rotated')

    const second = await rotate((first as { token: string }).token)
    expect(second.outcome).toBe('rotated')
    expect((second as { token: string }).token).not.toBe((first as { token: string }).token)
  })

  it('never issues a token that outlives its family', async () => {
    const family = await signIn()
    await db
      .update(refreshFamilies)
      .set({ expiresAt: sql`now() + make_interval(days => 3)` })
      .where(eq(refreshFamilies.id, family.familyId))

    const rotated = await rotate(family.token)

    const [row] = await db
      .select({ days: sql<number>`extract(epoch from (${refreshFamilies.expiresAt} - now())) / 86400` })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, family.familyId))

    expect(rotated.outcome).toBe('rotated')
    const left = ((rotated as { expiresAt: Date }).expiresAt.getTime() - Date.now()) / 86_400_000
    expect(left).toBeLessThan(Number(row!.days) + 0.01)
  })
})

/** ADR-0009 ②. The case the whole design exists to survive. */
describe('two callers, one token', () => {
  it('hands both the same successor and revokes nothing', async () => {
    const family = await signIn()

    const [a, b] = await Promise.all([rotate(family.token), rotate(family.token)])

    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toEqual(['replayed', 'rotated'])
    expect((a as { token: string }).token).toBe((b as { token: string }).token)

    const [family_] = await db
      .select({ revokedAt: refreshFamilies.revokedAt })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, family.familyId))
    expect(family_!.revokedAt).toBeNull()
  })

  it('leaves that successor usable, so the family has one live holder', async () => {
    const family = await signIn()
    const [a] = await Promise.all([rotate(family.token), rotate(family.token)])

    expect((await rotate((a as { token: string }).token)).outcome).toBe('rotated')
  })
})

/** ADR-0009. The detector, and the thing a stopwatch must not be able to fake. */
describe('reuse', () => {
  it('revokes the family when a token is presented after its window closed', async () => {
    const family = await signIn()
    await rotate(family.token)
    await spendLongAgo(family.familyId)

    const caught = await rotate(family.token)

    expect(caught.outcome).toBe('reuse')
    expect(caught).toMatchObject({ reason: 'outside_window', familyId: family.familyId })
    expect((caught as { secondsSinceConsumed: number }).secondsSinceConsumed).toBeGreaterThan(3000)
  })

  it('takes the successor down with the family, which is the point of a family', async () => {
    const family = await signIn()
    const rotated = await rotate(family.token)
    await spendLongAgo(family.familyId)
    await rotate(family.token)

    expect((await rotate((rotated as { token: string }).token)).outcome).toBe('refused')
  })

  it('revokes when a token is presented by a client it was never issued to', async () => {
    const family = await signIn()

    expect(await rotate(family.token, 'beacon')).toMatchObject({ reason: 'wrong_client' })
    expect((await rotate(family.token)).outcome).toBe('refused')
  })
})

/**
 * ADR-0013's other claim: revocation must not be able to race a rotation into leaving a
 * revoked family with a usable token. Asserted as an invariant over many attempts, because
 * the interleaving that would break it cannot be scheduled on demand.
 */
describe('revoking while a rotation is in flight', () => {
  it('never leaves a revoked family holding a token that still rotates', async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const family = await signIn()

      const [rotated] = await Promise.all([
        rotate(family.token),
        revokeFamily(db, family.familyId, 'logout'),
      ])

      const [row] = await db
        .select({ revokedAt: refreshFamilies.revokedAt })
        .from(refreshFamilies)
        .where(eq(refreshFamilies.id, family.familyId))

      if (row!.revokedAt && rotated.outcome === 'rotated') {
        const survivor = await rotate((rotated as { token: string }).token)
        expect(survivor.outcome, `attempt ${attempt}: a revoked family still rotates`).toBe(
          'refused',
        )
      }
    }
  })
})

/**
 * Everything that is merely over rather than stolen. Answering these with a revocation
 * would sign people out for being slow, which is how a detector gets switched off.
 */
describe('what is refused rather than treated as theft', () => {
  it('refuses a token that expired without ever being used', async () => {
    const family = await signIn()
    await db.execute(sql`update refresh_tokens set expires_at = now() - interval '1 second'`)

    expect((await rotate(family.token)).outcome).toBe('refused')

    const [row] = await db
      .select({ revokedAt: refreshFamilies.revokedAt })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, family.familyId))
    expect(row!.revokedAt).toBeNull()
  })

  it('refuses a token whose family is over', async () => {
    const family = await signIn()
    await db
      .update(refreshFamilies)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(refreshFamilies.id, family.familyId))

    expect((await rotate(family.token)).outcome).toBe('refused')
  })

  it('refuses a token whose family was revoked', async () => {
    const family = await signIn()
    await revokeFamily(db, family.familyId, 'logout')

    expect((await rotate(family.token)).outcome).toBe('refused')
  })

  it.each([
    ['a session token', `trs_${'a'.repeat(43)}`],
    ['a token nobody issued', `trr_${'a'.repeat(43)}`],
    ['nonsense', 'not-a-token'],
  ])('refuses %s', async (_label, token) => {
    expect((await rotate(token)).outcome).toBe('refused')
  })
})

/** Single logout: every family a user holds, regardless of which client opened it. */
describe('revoking every family a user holds', () => {
  const signInAs = async (userId: string, clientId: string) => openFamily(db, { userId, clientId })

  it('revokes every family for that user and leaves another user untouched', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
      .returning({ id: users.id })
    const harbor = await signInAs(user!.id, 'harbor')
    const beacon = await signInAs(user!.id, 'beacon')
    const other = await signIn()

    await revokeFamiliesForUser(db, user!.id, 'logout')

    const rows = await db
      .select({ id: refreshFamilies.id, revokedAt: refreshFamilies.revokedAt, revokedReason: refreshFamilies.revokedReason })
      .from(refreshFamilies)

    const revokedAt = (id: string) => rows.find((row) => row.id === id)?.revokedAt

    expect(revokedAt(harbor.familyId)).not.toBeNull()
    expect(revokedAt(beacon.familyId)).not.toBeNull()
    expect(rows.find((row) => row.id === harbor.familyId)?.revokedReason).toBe('logout')
    expect(revokedAt(other.familyId)).toBeNull()
  })

  it('leaves an already-revoked family with its original reason', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
      .returning({ id: users.id })
    const family = await signInAs(user!.id, 'harbor')
    await revokeFamily(db, family.familyId, 'reuse')

    await revokeFamiliesForUser(db, user!.id, 'logout')

    const [row] = await db
      .select({ revokedReason: refreshFamilies.revokedReason })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, family.familyId))
    expect(row!.revokedReason).toBe('reuse')
  })
})

/** Guards the helper above: a test that cannot reach the database must fail, not skip. */
describe('the harness', () => {
  it('is talking to a real database', async () => {
    const result = (await db.execute(sql`select 1 as ok`)) as unknown as Array<{ ok: number }>
    expect(result[0]?.ok).toBe(1)
  })
})
