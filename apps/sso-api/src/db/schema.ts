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
  // For revoking every session a user holds — 07/09.
  (table) => [index('sso_sessions_user_id_idx').on(table.userId)],
)

export type SsoSession = typeof ssoSessions.$inferSelect
