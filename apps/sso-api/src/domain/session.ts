import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import type { Database, Tx } from '../db/client'
import { ssoSessions } from '../db/schema'
import { SSO_SESSION_HARD, SSO_SESSION_IDLE } from './lifetimes'
import { hashToken, isTokenOfKind, mintToken } from './token'

/**
 * The SSO session — ADR-0001 ①. Both limits belong to this service alone: they are
 * answered to sso-web as an `expiresAt`, never configured on its side, so the two
 * cannot come to disagree.
 */

/**
 * Every timestamp is the database's, not this process's. Two clocks deciding one window
 * is a bug that only shows up under drift.
 */
export async function openSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = mintToken('session')

  const [session] = await db
    .insert(ssoSessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: sql`now() + ${SSO_SESSION_HARD}`,
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
): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
  if (!isTokenOfKind(token, 'session')) return null

  const [session] = await db
    .update(ssoSessions)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(ssoSessions.tokenHash, hashToken(token)),
        isNull(ssoSessions.revokedAt),
        gt(ssoSessions.expiresAt, sql`now()`),
        gt(ssoSessions.lastUsedAt, sql`now() - ${SSO_SESSION_IDLE}`),
      ),
    )
    .returning({
      id: ssoSessions.id,
      userId: ssoSessions.userId,
      expiresAt: ssoSessions.expiresAt,
    })

  return session ?? null
}

/**
 * Revocation keeps the row, and an already revoked session keeps its original time. Answers
 * the session's `userId` when it actually revoked something, so a caller can cascade into
 * single logout without a second lookup — and not when the token was already spent, so a
 * retry after a partial failure cascades exactly once.
 */
export async function revokeSession(
  db: Tx | Database,
  token: string,
): Promise<{ userId: string } | null> {
  if (!isTokenOfKind(token, 'session')) return null

  const [session] = await db
    .update(ssoSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(ssoSessions.tokenHash, hashToken(token)), isNull(ssoSessions.revokedAt)))
    .returning({ userId: ssoSessions.userId })

  return session ?? null
}
