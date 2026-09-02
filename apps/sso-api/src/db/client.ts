import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import type { Env } from '../env'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>['db']

/**
 * One pool for the process. Kept small on purpose: the free Postgres this runs
 * against has few connections to give, and a single Render instance serves every
 * request, so a large pool would only queue differently.
 */
export function createDatabase(env: Env) {
  const sql = postgres(env.DATABASE_URL, { max: 5 })
  return { db: drizzle(sql, { schema }), close: () => sql.end() }
}
