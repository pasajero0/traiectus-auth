import { eq } from 'drizzle-orm'

import type { Database } from '../db/client'
import { users } from '../db/schema'
import { phantomHash, verifyPassword } from './password'

/**
 * The only place a password is checked, and the choke point rate limiting takes on 07/09.
 * Transport-free — ADR-0005. Returns the principal or nothing: which half failed is not
 * something a caller has a use for.
 */
export async function verifyCredentials(
  db: Database,
  credentials: { email: string; password: string },
): Promise<{ userId: string } | null> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, credentials.email))
    .limit(1)

  // No such address. The verification still runs, so both failures cost the same.
  // Deleting this is a timing oracle.
  if (!user) {
    await verifyPassword(await phantomHash(), credentials.password)
    return null
  }

  const ok = await verifyPassword(user.passwordHash, credentials.password)
  return ok ? { userId: user.id } : null
}
