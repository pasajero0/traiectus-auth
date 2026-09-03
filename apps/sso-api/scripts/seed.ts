/**
 * One reproducible account for local testing, so a fresh database does not mean a fresh
 * throwaway registration every session. Idempotent — re-running this after the account
 * already exists is a no-op, not an error.
 *
 * Both values come from the environment and nowhere else: a real credential belongs in a
 * .env that git ignores, never in a script that gets committed. Neither is a substitute for
 * the checked-in migrations — this is data, not schema.
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=... pnpm --filter @traiectus/sso-api seed
 */
import { createDatabase } from '../src/db/client'
import { users } from '../src/db/schema'
import { hashPassword } from '../src/domain/password'
import { loadEnv } from '../src/env'

const email = process.env['SEED_ADMIN_EMAIL']
const password = process.env['SEED_ADMIN_PASSWORD']

if (!email || !password) {
  throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set — nothing to seed')
}

const env = loadEnv()
const { db, close } = createDatabase(env)

try {
  const [created] = await db
    .insert(users)
    .values({ email: email.trim().toLowerCase(), passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id })

  console.log(created ? `seeded ${email}` : `${email} already exists — nothing to do`)
} finally {
  await close()
}
