import { defineConfig } from 'tsup'

/**
 * A real build, not just source re-exported — Next.js and `tsup`-bundled apps
 * transpile `.ts` from a workspace package on the fly, but Vercel's own
 * function builder for `apps/harbor-api`'s `api/index.ts` does not, and fails
 * at runtime trying to resolve a `.ts` specifier. `@traiectus/contracts` is
 * bundled in too, so nothing this package exports depends on a sibling
 * workspace package still being resolvable as source at runtime.
 */
export default defineConfig({
  entry: {
    server: 'src/server/index.ts',
    resource: 'src/resource/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'neutral',
  // No `dts`: rollup-plugin-dts crashes against this repo's TypeScript 6.0.3
  // (a tsup-tooling version conflict, not a project bug). Types are served
  // straight from source instead — package.json's `exports` points the
  // `types` condition at the .ts file directly, which tsc reads natively;
  // only the JS runtime needed a real build, for Vercel's unbundled function.
  clean: true,
  sourcemap: true,
  noExternal: [/^@traiectus\//],
})
