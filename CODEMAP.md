# CODEMAP

Where things live. Six deployable applications, three shared packages, one repository —
see [ADR-0002](docs/decisions/0002-monorepo-layout.md) for why it is one repository.

| Path | What | Deploys to |
| --- | --- | --- |
| `apps/sso-web` | Identity service, browser-facing: sign-in pages, `/authorize`, the SSO cookie | Vercel |
| `apps/sso-api` | Identity service, machine-facing: users, argon2id, codes, tokens, database | Render |
| `apps/harbor-web` | Client product #1 — UI and its BFF | Vercel |
| `apps/harbor-api` | Harbor's resource server — verifies bearer tokens locally | Vercel |
| `apps/beacon-web` | Client product #2 — proof that one session spans both | Vercel |
| `apps/beacon-api` | Beacon's resource server, deliberately thin | Vercel |
| `packages/contracts` | Schemas for the identity protocol and both product APIs | — |
| `packages/auth-client` | SDK: `/server` (BFF), `/resource` (verification), `/react` (hooks) | — |
| `packages/ui` | Shared components for every web app. Empty until [ADR-0011](docs/decisions/0011-design-layer-copied-in.md) lands | — |
| `apps/sso-api/drizzle` | Migrations: checked-in SQL, applied at the end of the Render build | — |
| `docs/decisions` | ADRs — one decision each | — |
| `scripts/check-boundaries.mjs` | The boundary guard: CI step and PostToolUse hook | — |

## Entry points

| App | Serves | Local port |
| --- | --- | --- |
| `sso-web` | `src/app/` — pages plus `/authorize`, `/logout` | 4100 |
| `sso-api` | `src/index.ts` → `src/server.ts` → `src/routes/`, each mounted through `src/routing.ts`. Data in `src/db/`, logic in `src/domain/`, the setup for `*.db.test.ts` in `src/test/` | 4000 |
| `*-web` | `src/app/` (routes) · `src/server/` (server-only logic) | 3000, 3001 |
| `*-api` | `api/index.ts` on Vercel, `src/index.ts` locally → `src/app.ts` → `src/routes/` → `src/domain/` | 3100, 3101 |

`src/domain/` and `src/server/` are transport-free by rule ([ADR-0005](docs/decisions/0005-transport-free-product-layer.md)),
so a page, an HTTP handler and the mobile client in v2 all reach the same code.

## Harness

`.claude/`, `CLAUDE.md` and this file **are committed on purpose** — how the project is built
is part of what it demonstrates. Deployed with
[`@pasajero_0/agent-stack`](https://www.npmjs.com/package/@pasajero_0/agent-stack).

Only local overrides are excluded: `.claude/settings.local.json` (MCP servers, tokens) and
`.claude/tmp/`.
