import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import type { Env } from '../env'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>['db']

/** Inside a `db.transaction` callback — accepted wherever a write must share a caller's lock. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * One pool for the process. Kept small on purpose: the free Postgres this runs
 * against has few connections to give, and a single Render instance serves every
 * request, so a large pool would only queue differently.
 *
 * Render's Postgres refuses a plaintext connection outright — `FATAL: SSL/TLS required`
 * before any query runs. `ssl: 'require'` (the string form `postgres` documents) never
 * actually requests TLS on this driver version; only the object form does. Off locally:
 * the throwaway container in README's "Running locally" has no certificate to offer.
 */
export function createDatabase(env: Env) {
  const sql = postgres(env.DATABASE_URL, {
    max: 5,
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  })
  return { db: drizzle(sql, { schema }), close: () => sql.end() }
}
