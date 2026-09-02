import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests that need Postgres live behind `pnpm test:db` and their own config, so a clone
    // with no database still runs everything that does not need one.
    exclude: ['**/node_modules/**', '**/*.db.test.ts'],
  },
})
