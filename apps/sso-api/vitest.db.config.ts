import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/*.db.test.ts'],
    globalSetup: ['./src/test/migrate.ts'],
    // One database, shared. Rotation holds row locks, and parallel files against the same
    // rows would be testing the test runner rather than the code.
    fileParallelism: false,
  },
})
