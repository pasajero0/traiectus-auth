import { randomUUID } from 'node:crypto'

import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import type { Database, Tx } from '../db/client'
import { refreshFamilies, refreshTokens } from '../db/schema'
import { REFRESH_FAMILY, REFRESH_TOKEN, REPLAY_WINDOW } from './lifetimes'
import { openSuccessor, sealSuccessor } from './successor-cipher'
import { hashToken, isTokenOfKind, mintToken } from './token'

export type RotationOutcome =
  | { outcome: 'rotated'; token: string; expiresAt: Date; userId: string }
  /** The concurrency case: the same successor the winner received. Nothing is revoked. */
  | { outcome: 'replayed'; token: string; expiresAt: Date; userId: string }
  /** An attack. The family is already revoked; these fields exist to be logged. */
  | {
      outcome: 'reuse'
      familyId: string
      reason: 'wrong_client' | 'outside_window'
      secondsSinceConsumed: number | null
    }
  /** Unknown, expired, or belonging to a family that is over. Nothing to attribute. */
  | { outcome: 'refused' }

/** A token's life is capped by its family's, so the answer to the client is never a date
 * past which rotation would silently start refusing. */
const tokenExpiry = (familyId: string) =>
  sql`least(now() + ${REFRESH_TOKEN}, (select expires_at from refresh_families where id = ${familyId}))`

export async function openFamily(
  db: Database,
  { userId, clientId }: { userId: string; clientId: string },
): Promise<{ token: string; expiresAt: Date; familyId: string }> {
  return db.transaction(async (tx) => {
    const [family] = await tx
      .insert(refreshFamilies)
      .values({
        userId,
        clientId,
        expiresAt: sql`now() + ${REFRESH_FAMILY}`,
      })
      .returning({ id: refreshFamilies.id })

    if (!family) throw new Error('inserting a refresh family returned no row')

    const token = mintToken('refresh')
    const [issued] = await tx
      .insert(refreshTokens)
      .values({
        id: randomUUID(),
        familyId: family.id,
        tokenHash: hashToken(token),
        expiresAt: tokenExpiry(family.id),
      })
      .returning({ expiresAt: refreshTokens.expiresAt })

    if (!issued) throw new Error('inserting a refresh token returned no row')

    return { token, expiresAt: issued.expiresAt, familyId: family.id }
  })
}

/**
 * ADR-0009. The consume is the check, and the family is locked before it so that a caller
 * who loses the race waits here rather than reading a half-written row.
 */
export async function rotateRefreshToken(
  db: Database,
  key: Buffer,
  { token, clientId }: { token: string; clientId: string },
): Promise<RotationOutcome> {
  if (!isTokenOfKind(token, 'refresh')) return { outcome: 'refused' }

  const tokenHash = hashToken(token)

  return db.transaction(async (tx): Promise<RotationOutcome> => {
    // Finding the family, not checking the token. The check stays in the UPDATE below.
    const [present] = await tx
      .select({ id: refreshTokens.id, familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)

    if (!present) return { outcome: 'refused' }

    // Family first, always — ADR-0013. A rotation already in flight is waited out here,
    // which is what lets the re-read further down see committed state rather than a race.
    const [family] = await tx
      .select({
        id: refreshFamilies.id,
        userId: refreshFamilies.userId,
        clientId: refreshFamilies.clientId,
        revokedAt: refreshFamilies.revokedAt,
        over: sql<boolean>`${refreshFamilies.expiresAt} <= now()`,
      })
      .from(refreshFamilies)
      .where(eq(refreshFamilies.id, present.familyId))
      .for('update')

    if (!family || family.revokedAt || family.over) return { outcome: 'refused' }

    // A token presented by a client it was not issued to is not a mistake anyone makes by
    // accident: whoever holds it took it.
    if (family.clientId !== clientId) {
      await revokeFamilyWithin(tx, family.id, 'reuse')
      return {
        outcome: 'reuse',
        familyId: family.id,
        reason: 'wrong_client',
        secondsSinceConsumed: null,
      }
    }

    const successor = mintToken('refresh')
    const successorId = randomUUID()

    const [consumed] = await tx
      .update(refreshTokens)
      .set({
        consumedAt: sql`now()`,
        successorId,
        successorCiphertext: sealSuccessor(key, successor),
        replayUntil: sql`now() + ${REPLAY_WINDOW}`,
      })
      .where(
        and(
          eq(refreshTokens.id, present.id),
          isNull(refreshTokens.consumedAt),
          gt(refreshTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: refreshTokens.id })

    if (consumed) {
      const [issued] = await tx
        .insert(refreshTokens)
        .values({
          id: successorId,
          familyId: family.id,
          tokenHash: hashToken(successor),
          expiresAt: tokenExpiry(family.id),
        })
        .returning({ expiresAt: refreshTokens.expiresAt })

      if (!issued) throw new Error('inserting a successor returned no row')

      await wipeClosedWindows(tx, family.id)

      return {
        outcome: 'rotated',
        token: successor,
        expiresAt: issued.expiresAt,
        userId: family.userId,
      }
    }

    // No row came back. Holding the family lock means whoever beat us has committed, so
    // what is read now is final rather than in flight.
    const [spent] = await tx
      .select({
        consumedAt: refreshTokens.consumedAt,
        successorId: refreshTokens.successorId,
        successorCiphertext: refreshTokens.successorCiphertext,
        insideWindow: sql<boolean>`${refreshTokens.replayUntil} > now()`,
        secondsSinceConsumed: sql<number>`extract(epoch from now() - ${refreshTokens.consumedAt})`,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, present.id))
      .limit(1)

    // Never consumed, so the UPDATE failed on the expiry instead. An old token is not a
    // stolen one, and revoking a family over it would sign people out for being slow.
    if (!spent?.consumedAt) return { outcome: 'refused' }

    if (spent.insideWindow && spent.successorCiphertext && spent.successorId) {
      const replayed = openSuccessor(key, spent.successorCiphertext)

      if (replayed) {
        const [successorRow] = await tx
          .select({ expiresAt: refreshTokens.expiresAt })
          .from(refreshTokens)
          .where(eq(refreshTokens.id, spent.successorId))
          .limit(1)

        if (successorRow) {
          return {
            outcome: 'replayed',
            token: replayed,
            expiresAt: successorRow.expiresAt,
            userId: family.userId,
          }
        }
      }
    }

    await revokeFamilyWithin(tx, family.id, 'reuse')

    return {
      outcome: 'reuse',
      familyId: family.id,
      reason: 'outside_window',
      secondsSinceConsumed: Number(spent.secondsSinceConsumed),
    }
  })
}

export async function revokeFamily(
  db: Database,
  familyId: string,
  reason: string,
): Promise<void> {
  await revokeFamilyWithin(db, familyId, reason)
}

/** Single logout. `refresh_families_user_id_idx` makes this a lookup, not a scan. */
export async function revokeFamiliesForUser(
  db: Tx | Database,
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .update(refreshFamilies)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(refreshFamilies.userId, userId), isNull(refreshFamilies.revokedAt)))
}

async function revokeFamilyWithin(tx: Tx | Database, familyId: string, reason: string) {
  await tx
    .update(refreshFamilies)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(refreshFamilies.id, familyId), isNull(refreshFamilies.revokedAt)))
}

/**
 * Closed windows in this family only. `family_id` is indexed and `replay_until` is not, so
 * a global pass would be a sequential scan for a column nothing else searches by.
 */
async function wipeClosedWindows(tx: Tx, familyId: string) {
  await tx
    .update(refreshTokens)
    .set({ successorCiphertext: null })
    .where(
      and(
        eq(refreshTokens.familyId, familyId),
        lt(refreshTokens.replayUntil, sql`now()`),
        isNotNull(refreshTokens.successorCiphertext),
      ),
    )
}

/**
 * ADR-0015. Garbage is a row a week past hard expiry or a week past its terminal event — for
 * a token that is `consumed_at` (superseded by a successor), for a family that is
 * `revoked_at`. Deleting a garbage family cascades whatever tokens are still attached; most
 * are already gone on their own `consumed_at` rule by then. The closed-window wipe below is
 * the sequential-scan twin of `wipeClosedWindows` above — for a family that goes idle before
 * its next rotation ever wipes its own.
 */
export async function sweepRefreshRows(db: Database): Promise<void> {
  await db
    .delete(refreshTokens)
    .where(
      or(
        lt(refreshTokens.expiresAt, sql`now() - interval '7 days'`),
        and(
          isNotNull(refreshTokens.consumedAt),
          lt(refreshTokens.consumedAt, sql`now() - interval '7 days'`),
        ),
      ),
    )

  await db
    .delete(refreshFamilies)
    .where(
      or(
        lt(refreshFamilies.expiresAt, sql`now() - interval '7 days'`),
        and(
          isNotNull(refreshFamilies.revokedAt),
          lt(refreshFamilies.revokedAt, sql`now() - interval '7 days'`),
        ),
      ),
    )

  await db
    .update(refreshTokens)
    .set({ successorCiphertext: null })
    .where(and(lt(refreshTokens.replayUntil, sql`now()`), isNotNull(refreshTokens.successorCiphertext)))
}
