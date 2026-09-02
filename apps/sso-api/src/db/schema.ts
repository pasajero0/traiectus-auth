import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * The identity service owns this database and is the only thing that reads it.
 * No client product touches it — ADR-0002.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Stored already lower-cased. Normalising at the edge is not enough on its own:
     * a rule that only the application enforces is one refactor away from not being
     * enforced, so the database checks it too.
     */
    email: text('email').notNull().unique(),
    /** argon2id. The parameters live with the hash, in the encoded string. */
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('email_is_lower_case', sql`${table.email} = lower(${table.email})`)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

/**
 * The SSO session — ADR-0001 ①. The row is the truth; the cookie on sso-web's host
 * carries nothing but the identifier.
 */
export const ssoSessions = pgTable(
  'sso_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * SHA-256 of the bearer token, never the token. Not argon2id: the token is 256 bits
     * from node:crypto, so there is no dictionary to defend against and a 19 MiB hash on
     * every session check would buy nothing.
     */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Hard seven days. Never moved. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** The sliding twenty-four hours are measured from here, not stored derived. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    /** Revocation keeps the row. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // Revoking every session a user holds.
    index('sso_sessions_user_id_idx').on(table.userId),
    // What the sweeper filters on — ADR-0015.
    index('sso_sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export type SsoSession = typeof ssoSessions.$inferSelect

/**
 * A refresh family — one sign-in at one client, surviving every rotation. Revocation lives
 * here rather than on each token, because on the tokens it races an in-flight rotation and
 * can leave a revoked family holding one live successor. ADR-0013.
 */
export const refreshFamilies = pgTable(
  'refresh_families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Thirty days from the sign-in, never extended by a rotation. ADR-0013. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Why, in one word — `reuse`, `logout`, `credentials`. Read by humans after the fact. */
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('refresh_families_user_id_idx').on(table.userId),
    index('refresh_families_expires_at_idx').on(table.expiresAt),
  ],
)

/**
 * One generation of a family. `id` is minted by the caller rather than by the database, so
 * the successor can be named in the statement that consumes its predecessor — ADR-0009 ①.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => refreshFamilies.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /**
     * No foreign key: the successor is named while it is still being created, and a
     * constraint would have to be deferred to allow the very statement it exists to guard.
     */
    successorId: uuid('successor_id'),
    /** The successor's plaintext, AES-256-GCM under a key from the environment. ADR-0009 ②. */
    successorCiphertext: text('successor_ciphertext'),
    /** When the replay window closes and the ciphertext above is wiped. */
    replayUntil: timestamp('replay_until', { withTimezone: true }),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_expires_at_idx').on(table.expiresAt),
  ],
)

export type RefreshFamily = typeof refreshFamilies.$inferSelect
export type RefreshToken = typeof refreshTokens.$inferSelect
