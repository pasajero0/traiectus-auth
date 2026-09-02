import { randomBytes } from 'node:crypto'

import argon2 from 'argon2'

/**
 * Password hashing, and the only place its parameters are chosen.
 *
 * Written out rather than left to the library's defaults: the defaults are exactly
 * what a reviewer cannot see, and this is the number a reader of a security project
 * will want to check. These are OWASP's argon2id recommendation of 19 MiB with one
 * pass of parallelism — deliberately the memory-light option of the set, because the
 * service shares 512 MB with everything else it does and several concurrent sign-ins
 * must not exhaust it.
 *
 * The parameters travel inside the encoded hash, so raising them later does not
 * invalidate existing passwords: an old hash still verifies against the settings it
 * was made with.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS)
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

/**
 * A hash to verify against when there is no such user, so an unknown address costs the
 * same as a wrong password. Derived from random bytes at first use: a hash written into
 * the source is a committed credential, and nobody's password.
 */
let phantom: Promise<string> | null = null

export function phantomHash(): Promise<string> {
  return (phantom ??= hashPassword(randomBytes(32).toString('base64')))
}
