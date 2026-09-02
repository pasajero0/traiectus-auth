# traiectus-auth — project instructions

Single sign-on across multiple applications. This directory is public on purpose:
how the project is built is part of what it demonstrates.

## Layout

| Path | Role | Deploys to |
|---|---|---|
| `apps/sso-web` | Identity service, browser-facing: sign-in pages, `/authorize`, the SSO cookie. Next.js. | Vercel |
| `apps/sso-api` | Identity service, machine-facing: users, argon2id, codes, tokens, the database. Fastify. | Render |
| `apps/harbor-web` | Client product #1 — UI and its BFF. Next.js. | Vercel |
| `apps/harbor-api` | Harbor's own API. Resource server: verifies bearer tokens locally. | Vercel |
| `apps/beacon-web` | Client product #2 — two screens, exists to prove SSO. | Vercel |
| `apps/beacon-api` | Beacon's own API. Deliberately thin. | Vercel |
| `packages/contracts` | Schemas for the identity protocol and both product APIs. One source of truth. |  |
| `packages/auth-client` | SDK. `/server` (BFF), `/resource` (token verification), `/react` (hooks). |  |
| `packages/ui` | Shared components and design tokens, used by every web app including sign-in. |  |
| `docs/decisions` | ADRs. Short, numbered, one decision each. |  |

Read [ADR-0001](../docs/decisions/0001-session-model.md) before touching anything that
holds state, and [ADR-0004](../docs/decisions/0004-identity-service-split-by-audience.md)
before moving anything between `sso-web` and `sso-api`.

## The boundaries are real

`scripts/check-boundaries.mjs` enforces them on every edit and in CI. If it fires, fix the
code — never weaken the guard.

- Nothing outside `apps/sso-*` imports the identity service. Clients reach it over HTTP
  through `@traiectus/auth-client`, exactly as a third party would.
- `apps/sso-*` imports nothing belonging to a client. Clients are configured data.
- A `-web` and its `-api` are separate deployments. They share types through
  `@traiectus/contracts` and speak HTTP.
- `@traiectus/auth-client/resource` imports nothing from `next` or `react`. It has to run
  on any Node server, including the mobile client's backend in v2.
- Files under a web app's `src/server` start with `import 'server-only'`.
- No token reaches the browser at all: both live in an AEAD-sealed HttpOnly cookie owned by
  `<client>-web`, which attaches the bearer itself. Web storage is unused entirely — not for
  tokens, not for anything — and nothing secret ever goes in a URL. ADR-0008.
- A route is registered through one of four audience routers — `publicRouter`,
  `principalRouter`, `clientRouter`, `internalRouter` — never a bare framework instance. The
  principal comes only from a signature the service verified itself. ADR-0007.
- `Math.random()` never produces anything unguessable.
- Every bearer string carries its type prefix — `trs_`, `trr_`, `trc_` — checked before any
  lookup, so one kind of token cannot be presented where another is expected. ADR-0014.
- A table with a lifetime is created with a sweeper index in the same migration, and
  something deletes from it. ADR-0015.

Each client owns its own session cookie. The identity service issues authorization codes
and tokens; it never sets a cookie on a client's domain, because it cannot.

## Scope discipline

The ship date is fixed: **10 September 2026**. A sprawling auth project is the main reason
work like this never ships, so scope is defended rather than negotiated:

**Any "while we're here, let's also…" becomes a line in the README Roadmap, not a line of code.**

Out of scope, deliberately, and documented as such: full OIDC (discovery, JWKS, key
rotation, consent), public clients, social login, password reset, email
verification, roles and permissions, 2FA, multi-tenancy, client branding.

**Point of no return: 3 September 2026.** If cross-application sign-in does not work by
then, `beacon-web` and `beacon-api` are deleted and the project ships with one client, on
time.

This is a reference implementation of the model, not a production identity provider.
Say so plainly rather than implying otherwise.

## Security is the point of the artifact

A public auth project with a hole is worse than no project. Non-negotiable:

- `redirect_uri` validated against a configured allowlist. Exact match, no prefix matching.
- PKCE on every authorization request, `S256` only, no downgrade to `plain`. ADR-0016.
- Passwords hashed with argon2id. Never a fast hash.
- Anything unguessable comes from `node:crypto`.
- Authorization codes are single-use and short-lived.
- Refresh tokens rotate; presenting a used one revokes the whole family, outside the
  ten-second same-client replay window that keeps concurrent refreshes from self-revoking.
  ADR-0009.
- Rate limiting on login and token endpoints.
- Errors must not reveal whether an account exists.
- The internal key between `sso-web` and `sso-api` is configuration only, never committed.

## Provenance

Written from scratch. No code, schema, naming, or terminology is carried over from any
employer's system. "SSO" is industry vocabulary and is fine; product acronyms, role names,
cookie names and endpoint shapes from elsewhere are not. If a name sounds like it belongs
to someone else's product, rename it.

## Conventions

- TypeScript everywhere, `strict`. No `any`; if a type is genuinely unknown, model it.
- Validate input with zod at the edge, derive types from the schema.
- Product API paths are versioned (`/v1/…`) from the first commit.
- `apps/sso-api` uses Drizzle; migrations are checked-in SQL, applied at the end of the
  Render build. **Every migration must be compatible with the release already running** —
  the free tier has no pre-deploy step, so the schema changes while the previous version
  is still serving. Additive changes ship alone; a removal is two deploys: stop using the
  column, then drop it.
- A comment earns its place by stopping a specific wrong edit — one or two lines, naming
  the ADR rather than restating its argument. Three kinds do not earn it: a retelling of
  the code, a second derivation of a decision an ADR already holds, and alternatives that
  were never in this file. Longer than that, and it belongs in an ADR or in the
  application's state document. ADR-0012.
- A discriminated union's discriminant is a technical marker, not prose: one name
  everywhere. Every `/verify` route answers `verified`.
- Tests that need Postgres are `*.db.test.ts`, run by `pnpm --filter @traiectus/sso-api
  test:db` with `TEST_DATABASE_URL`. `pnpm verify` deliberately does not run them, so a green
  verify is not a green suite; CI runs both.
- Every non-obvious decision gets an ADR before the code it justifies.
- Commit daily. History should show a project being kept, not one dumped in a night.
