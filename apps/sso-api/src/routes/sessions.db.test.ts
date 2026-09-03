import { randomBytes } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { refreshFamilies, users } from '../db/schema'
import { openFamily } from '../domain/refresh'
import { openSession } from '../domain/session'
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
