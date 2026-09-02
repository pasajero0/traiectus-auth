import { defineConfig } from 'drizzle-kit'

/**
 * `generate` reads only the schema; `migrate` is the one that needs the URL.
 * Read directly rather than through loadEnv, because migrations have no business
 * requiring a signing key or an internal secret to run.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
