import { z } from 'zod'

/**
 * Every environment variable the identity service reads, validated once at boot.
 * A missing or malformed value fails loudly at startup rather than at 3am.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Set by Render on deploy; absent locally. */
  RENDER_GIT_COMMIT: z.string().optional(),
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
