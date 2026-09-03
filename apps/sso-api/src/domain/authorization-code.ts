import { createHash } from 'node:crypto'

import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import type { Database } from '../db/client'
import { authorizationCodes, ssoSessions } from '../db/schema'
import { AUTHORIZATION_CODE } from './lifetimes'
import { hashToken, isTokenOfKind, mintToken } from './token'

export type CodeRedemption =
  | { redeemed: true; userId: string; ssoSessionId: string }
  /** `replayed` is an attack and is logged as one — ADR-0001 ②. The rest are merely over. */
  | { redeemed: false; reason: 'unknown' | 'expired' | 'replayed' | 'mismatch' | 'revoked' }

export async function issueCode(
  db: Database,
  code: {
    clientId: string
    redirectUri: string
    userId: string
    ssoSessionId: string
    codeChallenge: string
  },
): Promise<{ code: string; expiresAt: Date }> {
  const value = mintToken('code')

  const [issued] = await db
    .insert(authorizationCodes)
    .values({
      codeHash: hashToken(value),
      clientId: code.clientId,
      redirectUri: code.redirectUri,
      userId: code.userId,
      ssoSessionId: code.ssoSessionId,
      codeChallenge: code.codeChallenge,
      expiresAt: sql`now() + ${AUTHORIZATION_CODE}`,
    })
    .returning({ expiresAt: authorizationCodes.expiresAt })

  if (!issued) throw new Error('inserting an authorization code returned no row')

  return { code: value, expiresAt: issued.expiresAt }
}

/** Not a foreign-key check: `sso_session_id` is never null, but ended a session may be. */
const sessionIsLive = sql`not exists (
  select 1 from ${ssoSessions}
   where ${ssoSessions.id} = ${authorizationCodes.ssoSessionId}
     and ${ssoSessions.revokedAt} is not null
)`

/**
 * Single use, by the statement that checks it — ADR-0009 ①, the same shape as rotation.
 * Bindings are compared after the code is spent: leaving it live on a wrong verifier would
 * let whoever holds it keep guessing. The session check closes ADR-0018's Consequences: a
 * code is bound to the session that produced it, so logging out invalidates it too.
 */
export async function redeemCode(
  db: Database,
  presented: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<CodeRedemption> {
  if (!isTokenOfKind(presented.code, 'code')) return { redeemed: false, reason: 'unknown' }

  const codeHash = hashToken(presented.code)

  const [spent] = await db
    .update(authorizationCodes)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(authorizationCodes.codeHash, codeHash),
        isNull(authorizationCodes.consumedAt),
        gt(authorizationCodes.expiresAt, sql`now()`),
        sessionIsLive,
      ),
    )
    .returning({
      userId: authorizationCodes.userId,
      ssoSessionId: authorizationCodes.ssoSessionId,
      clientId: authorizationCodes.clientId,
      redirectUri: authorizationCodes.redirectUri,
      codeChallenge: authorizationCodes.codeChallenge,
    })

  if (!spent) {
    const [row] = await db
      .select({
        consumedAt: authorizationCodes.consumedAt,
        sessionRevoked: sql<boolean>`not (${sessionIsLive})`,
      })
      .from(authorizationCodes)
      .where(eq(authorizationCodes.codeHash, codeHash))
      .limit(1)

    if (!row) return { redeemed: false, reason: 'unknown' }
    if (row.consumedAt) return { redeemed: false, reason: 'replayed' }
    if (row.sessionRevoked) return { redeemed: false, reason: 'revoked' }
    return { redeemed: false, reason: 'expired' }
  }

  const matches =
    spent.clientId === presented.clientId &&
    spent.redirectUri === presented.redirectUri &&
    challengeFor(presented.codeVerifier) === spent.codeChallenge

  if (!matches) return { redeemed: false, reason: 'mismatch' }

  return { redeemed: true, userId: spent.userId, ssoSessionId: spent.ssoSessionId }
}

/**
 * ADR-0015/ADR-0018: "on the same terms as everything else with a lifetime." A consumed
 * code — redeemed, or spent on a failed check, ADR-0009 ① — is done at `consumed_at`, which
 * is why that clause deletes it sooner than an unconsumed code's own 60-second `expires_at`
 * plus the week.
 */
export async function sweepExpiredCodes(db: Database): Promise<void> {
  await db
    .delete(authorizationCodes)
    .where(
      or(
        lt(authorizationCodes.expiresAt, sql`now() - interval '7 days'`),
        and(
          isNotNull(authorizationCodes.consumedAt),
          lt(authorizationCodes.consumedAt, sql`now() - interval '7 days'`),
        ),
      ),
    )
}

/** S256, and only S256 — ADR-0016. */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
