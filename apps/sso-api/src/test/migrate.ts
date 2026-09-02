import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Brings the test database up to the checked-in migrations before anything runs, so the
 * suite is testing the schema that will be deployed rather than one written by hand.
 */
export async function setup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL']

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is unset. These tests need a real Postgres — see "Running locally".',
    )
  }

  // Notices are silenced because the migrator's own CREATE TABLE IF NOT EXISTS emits one on
  // every run after the first, and a green suite that prints a Postgres error object is one
  // nobody reads carefully afterwards.
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  await sql.end()
}
