import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3100),
  /**
   * Verification is local; this service never calls the identity service. Required:
   * without it there is nothing to check a bearer token against, so the service
   * refuses to start rather than come up unable to verify anything.
   */
  ACCESS_TOKEN_PUBLIC_KEY: z.string().min(1),
  /** Must equal the token's `iss`. sso-web's origin — see ADR-0017. */
  ISSUER: z.string().url(),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A variable that exists but is blank means absent, not empty. Deployment
  // platforms produce exactly that when a name is imported from .env.example
  // without a value, and it defeats both halves of the schema: z.coerce.number()
  // turns '' into 0, and .default() only fires on undefined.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''))
  const result = envSchema.safeParse(present)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${details}`)
  }

  return result.data
}
