import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3101),
  /** Verification is local; this service never calls the identity service. */
  ACCESS_TOKEN_PUBLIC_KEY: z.string().default(''),
  /** The single browser origin permitted to call this API. */
  ALLOWED_ORIGIN: z.string().url(),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${details}`)
  }

  return result.data
}
