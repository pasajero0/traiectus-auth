import { sql } from 'drizzle-orm'

import { createDatabase, type Database } from '../db/client'
import { loadEnv } from '../env'

/**
 * A connection to the test database. The pool is deliberately larger than one: a test that
 * runs two rotations at once needs two connections, or it deadlocks against itself instead
 * of exercising the lock.
 */
export function testDatabase(): { db: Database; close: () => Promise<unknown> } {
  const url = process.env['TEST_DATABASE_URL']
  if (!url) throw new Error('TEST_DATABASE_URL is unset')

  return createDatabase(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      INTERNAL_API_KEY: 'test-internal-key',
      DATABASE_URL: url,
    } as NodeJS.ProcessEnv),
  )
}

/** Every table, in one statement, so no order of deletion has to be maintained by hand. */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table refresh_tokens, refresh_families, sso_sessions, users restart identity cascade`,
  )
}
