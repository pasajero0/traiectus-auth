# traiectus-auth

*The crossing.* Authentication is the point where an anonymous request
becomes an identified session.

Single sign-on across multiple applications: Node/TypeScript identity service,
Next.js clients, refresh-token rotation with reuse detection.
Built and maintained through an agentic harness.

---

> **Work in progress.** The identity service stores users and accepts registration;
> signing in is next. Target: 10 September 2026.

## How it fits together

```
                    ┌──────────────┐        ┌──────────────┐
  browser ────────► │   sso-web    │ ─────► │   sso-api    │ ──► Postgres
                    │ sign-in      │  HTTP  │ users, codes │
                    │ /authorize   │ secret │ tokens       │
                    │ cookie       │        └──────────────┘
                    └──────────────┘               ▲
                            │ code                 │ POST /v1/token
                            ▼                      │ (server to server)
                    ┌──────────────┐               │
  browser ────────► │  harbor-web  │ ──────────────┘
                    │ UI + BFF     │
                    │ sealed cookie│
                    └──────────────┘
                            │ bearer token, attached server-side
                            ▼
                    ┌──────────────┐
                    │  harbor-api  │  verifies the signature locally,
                    │ product data │  never calls back
                    └──────────────┘
                            ▲
                            └──────── harbor-mobile (v2), token in the keychain
```

`beacon-web` and `beacon-api` are the same shape. Signing in at Harbor and then opening
Beacon lands you inside without a form — that is the fact this repository exists to show.

## Layout

| Path | Role |
|---|---|
| `apps/sso-web` | Identity service, browser-facing: sign-in pages, `/authorize`, the SSO cookie. |
| `apps/sso-api` | Identity service, machine-facing: users, passwords, codes, tokens, database. |
| `apps/harbor-web` · `apps/harbor-api` | Client product #1 — its UI and its own API. |
| `apps/beacon-web` · `apps/beacon-api` | Client product #2 — proof that one session spans both. |
| `packages/contracts` | Schemas shared by every side. |
| `packages/auth-client` | SDK — `/server`, `/resource`, `/react`. |
| `packages/ui` | Shared components for every web app, sign-in pages included. Empty until [ADR-0011](docs/decisions/0011-design-layer-copied-in.md) lands. |
| `docs/decisions` | Architecture decision records. |
| `.claude` | Harness configuration. Public on purpose. |

The boundaries are enforced, not merely intended: `scripts/check-boundaries.mjs` runs on
every edit and in CI. Clients cannot import the identity service, a `-web` cannot import its
`-api`, and the SDK's token-verification half cannot reach for a framework.

Start with [ADR-0001](docs/decisions/0001-session-model.md) — what remembers the user, who
owns each cookie, and what logging out revokes. Then
[ADR-0004](docs/decisions/0004-identity-service-split-by-audience.md) for why the identity
service is split the way it is,
[ADR-0007](docs/decisions/0007-authentication-is-a-router-property.md) for why a route
cannot be written without naming its audience, and
[ADR-0008](docs/decisions/0008-no-token-reaches-the-browser.md) for why no token ever
reaches browser JavaScript.

## Running locally

The identity service needs Postgres. A throwaway one, matching the `DATABASE_URL`
in `apps/sso-api/.env.example`:

```bash
docker run -d --name traiectus-pg \
  -e POSTGRES_USER=traiectus -e POSTGRES_PASSWORD=traiectus -e POSTGRES_DB=traiectus \
  -p 5432:5432 postgres:16
```

Then:

```bash
pnpm install
pnpm setup:local                              # writes six .env / .env.local files
pnpm --filter @traiectus/sso-api db:migrate   # reads DATABASE_URL from your shell
pnpm dev
```

`setup:local` fills in what the `.env.example` files leave blank: one signing key pair
split between `sso-api` and the product APIs, one internal key shared by `sso-api` and
`sso-web`, and a secret per client that matches on both sides. Everything it writes is
gitignored and throwaway — `pnpm setup:local --force` regenerates the whole set. It refuses
to fill in half a set, because halves that disagree are worse than none.

| Service | URL |
|---|---|
| sso-web | http://localhost:4100 |
| sso-api | http://localhost:4000/health |
| harbor-web | http://localhost:3000 |
| harbor-api | http://localhost:3100 |
| beacon-web | http://localhost:3001 |
| beacon-api | http://localhost:3101 |

Everything CI checks, in one command:

```bash
pnpm verify   # guards, lint, types, tests
```

Rotation and reuse detection are claims about what happens when two callers race for one
row, so their tests need a real Postgres and live behind a second command. Give them a
database of their own — they migrate it and truncate it:

```bash
docker exec traiectus-pg psql -U traiectus -d postgres -c 'create database traiectus_test'

TEST_DATABASE_URL=postgres://traiectus:traiectus@localhost:5432/traiectus_test \
  pnpm --filter @traiectus/sso-api test:db
```

With `TEST_DATABASE_URL` unset they fail rather than skip: a suite that quietly runs nothing
is worse than one that does not run.

## Scope

This is a reference implementation demonstrating the model — not a production-ready
identity provider. Full OIDC is out of scope; see Roadmap.

The model is the one Keycloak, Zitadel and Ory Hydra implement, written out so that every
decision in it is visible and argued — see `docs/decisions`.

**Roadmap:** OIDC discovery and JWKS, signing-key rotation, public clients,
two-factor authentication, social login — at the identity service, so the products keep
exactly one issuer ([ADR-0017](docs/decisions/0017-the-authorization-response-names-its-issuer.md)) —
password reset, email verification, roles and
permissions, a shared design layer in `packages/ui` (Tailwind and shadcn/ui, copied in
rather than depended on), a React Native client on the same identity service, and
forwarding the real client IP from `sso-web` to `sso-api` so rate limiting can key on the
caller instead of one bucket shared by every request the identity service receives.
