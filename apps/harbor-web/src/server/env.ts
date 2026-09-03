import 'server-only'

import { z } from 'zod'

const envSchema = z.object({
  SSO_WEB_URL: z.string().url(),
  SSO_API_URL: z.string().url(),
  TRAIECTUS_CLIENT_ID: z.string().min(1),
  TRAIECTUS_CLIENT_SECRET: z.string().min(1),
  SESSION_SEAL_KEY: z.string().min(1),
  HARBOR_API_URL: z.string().url(),
  APP_BASE_URL: z.string().url(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/** Read on the first request, not at module load — see sso-api's loadEnv for why. */
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
