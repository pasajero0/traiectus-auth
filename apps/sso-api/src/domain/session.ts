import { createHash, randomBytes } from 'node:crypto'

import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import type { Database } from '../db/client'
import { ssoSessions } from '../db/schema'

/**
 * The SSO session — ADR-0001 ①. Both limits belong to this service alone: they are
 * answered to sso-web as an `expiresAt`, never configured on its side, so the two
 * cannot come to disagree.
 */
const HARD_LIFETIME_DAYS = 7
const IDLE_LIFETIME_HOURS = 24

/** 256 bits from node:crypto. Base64url, so a cookie carries it unencoded. */
export function mintSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Every timestamp is the database's, not this process's. Two clocks deciding one window
 * is a bug that only shows up under drift.
 */
export async function openSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = mintSessionToken()

  const [session] = await db
    .insert(ssoSessions)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: sql`now() + make_interval(days => ${HARD_LIFETIME_DAYS})`,
    })
    .returning({ expiresAt: ssoSessions.expiresAt })

  if (!session) throw new Error('inserting a session returned no row')

  return { token, expiresAt: session.expiresAt }
}

/**
 * Checks both windows and slides the idle one in a single statement, so an expired
 * session cannot be extended by a request that arrives between the read and the write.
 * Splitting this in two reintroduces that race.
 */
export async function verifySession(
  db: Database,
  token: string,
): Promise<{ userId: string; expiresAt: Date } | null> {
  const [session] = await db
    .update(ssoSessions)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(ssoSessions.tokenHash, hashSessionToken(token)),
        isNull(ssoSessions.revokedAt),
        gt(ssoSessions.expiresAt, sql`now()`),
        gt(ssoSessions.lastUsedAt, sql`now() - make_interval(hours => ${IDLE_LIFETIME_HOURS})`),
      ),
    )
    .returning({ userId: ssoSessions.userId, expiresAt: ssoSessions.expiresAt })

  return session ?? null
}

/** Revocation keeps the row, and an already revoked session keeps its original time. */
export async function revokeSession(db: Database, token: string): Promise<void> {
  await db
    .update(ssoSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(ssoSessions.tokenHash, hashSessionToken(token)), isNull(ssoSessions.revokedAt)),
    )
}
