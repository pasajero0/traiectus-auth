import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Restricted-import groups, named once because a flat-config block that sets
// `no-restricted-imports` replaces the rule outright rather than merging into
// it. Every block below therefore restates every group that applies to its
// files — the product APIs are subject to both.
const NO_IDENTITY_SERVICE_IMPORT = {
  group: ['@traiectus/sso-*', '**/apps/sso-*/**'],
  message:
    'Applications reach the identity service over HTTP via @traiectus/auth-client. Importing its code would erase the service boundary.',
}

const NO_SSO_API_IMPORT = {
  group: ['@traiectus/sso-api', '**/apps/sso-api/**'],
  message:
    'sso-web reaches sso-api from its own server over HTTP, with the internal shared secret. They are separate deployments — ADR-0004.',
}

const NO_UI_IN_AN_API = {
  group: ['@traiectus/ui', '@traiectus/ui/*'],
  message: 'A resource server returns JSON. It has no user interface to share.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The boundaries, expressed for the editor. The authoritative checks live in
    // scripts/check-boundaries.mjs (CI + agent hook) so they cannot be silenced
    // with an inline disable comment.
    files: ['apps/harbor-web/**', 'apps/beacon-web/**', 'packages/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_IDENTITY_SERVICE_IMPORT] }],
    },
  },
  {
    // A product API is a client of the identity service too, so it carries both
    // groups. Listing only the second would silently drop the first.
    files: ['apps/harbor-api/**', 'apps/beacon-api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [NO_IDENTITY_SERVICE_IMPORT, NO_UI_IN_AN_API] },
      ],
    },
  },
  {
    // The identity service is not restricted from importing itself.
    files: ['apps/sso-api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_UI_IN_AN_API] }],
    },
  },
  {
    // The identity service's own two halves are a -web/-api pair like any other.
    files: ['apps/sso-web/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_SSO_API_IMPORT] }],
    },
  },
  {
    // Tooling that runs on Node directly rather than through a bundler. Listed by hand
    // instead of pulling in `globals` for four names.
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
)
