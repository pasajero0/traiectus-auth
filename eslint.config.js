import js from '@eslint/js'
import tseslint from 'typescript-eslint'

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
    files: ['apps/harbor-*/**', 'apps/beacon-*/**', 'packages/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@traiectus/sso-*', '**/apps/sso-*/**'],
              message:
                'Applications reach the identity service over HTTP via @traiectus/auth-client. Importing its code would erase the service boundary.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/*-api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@traiectus/ui', '@traiectus/ui/*'],
              message: 'A resource server returns JSON. It has no user interface to share.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
)
