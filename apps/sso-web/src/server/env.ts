import 'server-only'

import { z } from 'zod'

const envSchema = z.object({
  SSO_API_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(1),
  SSO_WEB_URL: z.string().url(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/**
 * Read on the first request, not at module load: `next build` runs where none of these
 * exist. Blank counts as absent, for the reason given in sso-api's loadEnv.
 */
export function env(): Env {
  if (cached) return cached

  const present = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ''),
  )
  const result = envSchema.safeParse(present)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${details}`)
  }

  cached = result.data
  return cached
}
