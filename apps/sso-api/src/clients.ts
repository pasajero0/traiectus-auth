import { timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import type { Env } from './env'

/** Clients are configured data, never rows — `.claude/CLAUDE.md`. */
const clientSchema = z.object({
  id: z.string().min(1).max(64),
  secret: z.string().min(32),
  /** Exact strings — a prefix rule turns one registered path into every path beneath it. */
  redirectUris: z.array(z.string().url()).min(1),
})

const registrySchema = z.array(clientSchema).min(1)

export type Client = z.infer<typeof clientSchema>

let registry: readonly Client[] | null = null

/** The registry is read once per process, so tests that build a different one say so. */
export function resetClients(): void {
  registry = null
}

export function clients(env: Env): readonly Client[] {
  if (registry) return registry

  if (!env.CLIENTS) {
    throw new Error('no clients are configured; CLIENTS is unset')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(env.CLIENTS)
  } catch {
    throw new Error('CLIENTS is not valid JSON')
  }

  const result = registrySchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`CLIENTS is malformed: ${result.error.issues[0]?.message ?? 'unknown'}`)
  }

  registry = result.data
  return registry
}

export function findClient(env: Env, id: string): Client | null {
  return clients(env).find((client) => client.id === id) ?? null
}

export function allowsRedirect(client: Client, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri)
}

/** Constant time, for the same reason the internal key is compared that way. */
export function presentsSecret(client: Client, presented: string): boolean {
  const expected = Buffer.from(client.secret, 'utf8')
  const given = Buffer.from(presented, 'utf8')

  return given.length === expected.length && timingSafeEqual(given, expected)
}
