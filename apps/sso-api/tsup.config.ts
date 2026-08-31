import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Workspace packages ship as TypeScript source, so they are bundled in
  // rather than resolved at runtime. Real dependencies stay external.
  noExternal: [/^@traiectus\//],
})
