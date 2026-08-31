import type { NextConfig } from 'next'

const config: NextConfig = {
  // Workspace packages ship as TypeScript source rather than a build output,
  // so there is no build graph to keep in sync during development.
  transpilePackages: ['@traiectus/contracts', '@traiectus/auth-client', '@traiectus/ui'],
}

export default config
