import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { refreshFamilies, ssoSessions, users } from '../db/schema'
import { openFamily } from '../domain/refresh'
import { openSession, revokeSession } from '../domain/session'
import { resetRouteTable } from '../routing'
import { buildServer } from '../server'
import { testDatabase, testEnv, truncateAll } from '../test/database'

const { db, close } = testDatabase()
const withKey = { 'x-traiectus-internal-key': 'test-internal-key' }

let app: Awaited<ReturnType<typeof buildServer>>

beforeEach(async () => {
  resetRouteTable()
  await truncateAll(db)
  app = await buildServer(testEnv(), db)
  await app.ready()
})

afterAll(async () => {
  await close()
})

describe('POST /v1/sessions/verify', () => {
  it('answers the session owner\'s email alongside the userId', async () => {
    const email = `t-${randomBytes(6).toString('hex')}@example.com`
    const [user] = await db.insert(users).values({ email, passwordHash: 'x' }).returning({
      id: users.id,
    })
    const session = await openSession(db, user!.id)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/verify',
      headers: withKey,
      payload: { token: session.token },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ verified: true, userId: user!.id, email })
  })

  it('says only verified: false for a token that names no live session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/verify',
      headers: withKey,
      payload: { token: 'trs_' + 'a'.repeat(43) },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ verified: false })
  })
})

/** Single logout, exercised through the endpoint sso-web's own /logout calls. */
describe('DELETE /v1/sessions', () => {
  it('cascades into every refresh family the session owner holds', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
      .returning({ id: users.id })
    const session = await openSession(db, user!.id)
    const harbor = await openFamily(db, { userId: user!.id, clientId: 'harbor' })
    const beacon = await openFamily(db, { userId: user!.id, clientId: 'beacon' })

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions',
      headers: withKey,
      payload: { token: session.token },
    })

    expect(response.statusCode).toBe(204)

    const rows = await db
      .select({ id: refreshFamilies.id, revokedAt: refreshFamilies.revokedAt })
      .from(refreshFamilies)
    expect(rows.find((row) => row.id === harbor.familyId)?.revokedAt).not.toBeNull()
    expect(rows.find((row) => row.id === beacon.familyId)?.revokedAt).not.toBeNull()
  })

  it('touches no family when the token names no live session', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
      .returning({ id: users.id })
    const family = await openFamily(db, { userId: user!.id, clientId: 'harbor' })

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions',
      headers: withKey,
      payload: { token: 'trs_' + 'a'.repeat(43) },
    })

    expect(response.statusCode).toBe(204)

    const [row] = await db
      .select({ revokedAt: refreshFamilies.revokedAt })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, family.familyId))
    expect(row!.revokedAt).toBeNull()
  })
})

/**
 * The route's comment claims a mid-way failure can't leave the session gone but a family
 * still live — a property of `db.transaction`, not of anything the route itself enforces.
 * This forces exactly that failure, the same way the route would hit one, and checks the
 * rollback actually happens rather than trusting the framework silently.
 */
describe('the transaction the route relies on', () => {
  it('rolls the session revoke back too when the family revoke after it fails', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `t-${randomBytes(6).toString('hex')}@example.com`, passwordHash: 'x' })
      .returning({ id: users.id })
    const session = await openSession(db, user!.id)

    await expect(
      db.transaction(async (tx) => {
        const revoked = await revokeSession(tx, session.token)
        expect(revoked).not.toBeNull()
        throw new Error('forced failure after the session revoke, before anything else')
      }),
    ).rejects.toThrow('forced failure')

    const [row] = await db
      .select({ revokedAt: ssoSessions.revokedAt })
      .from(ssoSessions)
      .where(eq(ssoSessions.userId, user!.id))
    expect(row!.revokedAt).toBeNull()
  })
})
