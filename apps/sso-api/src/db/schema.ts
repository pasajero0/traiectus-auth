import { sql } from 'drizzle-orm'
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
