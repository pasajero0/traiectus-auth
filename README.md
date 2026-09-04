# traiectus-auth

*The crossing.* Authentication is the point where an anonymous request
becomes an identified session.

Single sign-on across multiple applications: Node/TypeScript identity service,
Next.js clients, refresh-token rotation with reuse detection.
Built and maintained through an agentic harness.

---

> **Working, and deployed.** Sign in once at the identity service and both client products
> let you in without a second password. What is left before 10 September 2026 is the shared
> design layer, screenshots, and this file.

## See it running

| | |
|---|---|
| **Identity service** | https://traiectus-auth-sso-web.vercel.app |
| Harbor — client product #1 | https://traiectus-auth-harbor-web.vercel.app |
| Beacon — client product #2 | https://traiectus-auth-beacon-web.vercel.app |

The walk that is the point of the repository:

1. Open **Harbor**. It sends you to the identity service, because a product here has no
   page that renders without a session ([ADR-0019](docs/decisions/0019-a-product-has-no-unauthenticated-content.md)).
2. Create an account, or sign in. One password, typed once.
3. Open **Beacon**. No form. You are already inside, and the two products never shared a
   cookie, a database, or a session — only an issuer.

> **The demonstration's data is temporary.** Its database is on a free plan that the
> platform deletes 30 days after creation, so accounts made here go with it. Do not use a
> password you use anywhere else — and there is no reason to: the account is throwaway by
> design.

`sso-api` sleeps when idle, so the first request after a quiet spell takes about a minute.
Health, if you want to wake it first: [`/health`](https://traiectus-sso-api.onrender.com/health).

## What works today

- **Sign-in** on the identity service's own origin, with the SSO session in an HttpOnly
  cookie it alone owns.
- **Registration**, with the password typed twice and shown on request.
- **`/authorize` with PKCE**, authorization codes that are single-use and short-lived, and
  `POST /v1/token` for both grants.
- **Refresh rotation with reuse detection** — presenting a spent token revokes the whole
  family, outside a ten-second window that keeps concurrent refreshes from self-revoking.
- **Two client products** on one session, each with its own API that verifies tokens
  locally and never calls back.
- **Single logout**: ending the SSO session revokes every refresh family the account holds,
  across both products, in one transaction.
- **Rate limiting** on registration, sign-in and the token endpoint.

**196 unit tests**, **65 against a real Postgres**, and **23 ADRs** — one per decision that
was not obvious, written before the code it justifies.

## Security

The properties this project treats as non-negotiable, and where each is argued:

- **No token reaches the browser.** Both tokens live in an AEAD-sealed HttpOnly cookie owned
  by the product's own server, which attaches the bearer itself. Web storage is unused
  entirely. [ADR-0008](docs/decisions/0008-no-token-reaches-the-browser.md)
- **PKCE on every authorization request**, `S256` only — no downgrade to `plain`, because a
  downgrade path is the attack it would be defending against. [ADR-0016](docs/decisions/0016-pkce-on-every-authorization-request.md)
- **`redirect_uri` matched exactly** against a configured allowlist. No prefix matching.
- **Passwords hashed with argon2id** at OWASP's parameters, written out rather than left to
  a library default. An address nobody registered still costs a full hash, so timing says
  nothing.
- **Every bearer carries its type** — `trs_`, `trr_`, `trc_` — checked before any lookup, so
  one kind of token cannot be presented where another is expected. [ADR-0014](docs/decisions/0014-a-token-says-what-kind-it-is.md)
- **A route cannot be written without naming its audience.** Four routers — public,
  principal, client, internal — and a test that walks the actually-mounted route table and
  fails on anything that arrived another way. [ADR-0007](docs/decisions/0007-authentication-is-a-router-property.md)
- **Rate limits keyed by what the caller cannot change.** Sign-in counts failures against
  the *account*, as OWASP and NIST SP 800-63B ask, with a looser per-address net behind it;
  successful sign-ins never count, so the limit cannot be turned around to lock someone out
  of their own account. [ADR-0023](docs/decisions/0023-the-caller-is-forwarded-across-the-internal-boundary.md)
- **Signing in never reveals whether an account exists** — one message for every failure,
  and equal time. Registration is the stated exception, argued rather than glossed over.
  [ADR-0022](docs/decisions/0022-registration-admits-a-conflict.md)

And what is **not** protected, because a security claim this project does not hold would be
worse than an absent one:

- No `script-src` in the Content-Security-Policy yet. Frame, referrer and sniffing
  protections are in place; a script policy needs its own pass.
- The demonstration's database has no backups, and the platform deletes it on a schedule.
- Rate-limit counters live in the process. One instance runs, so they hold; a second would
  need a shared store.

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
                            └──────── harbor-mobile — planned for v2, not built
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
| `packages/ui` | Shared components for every web app. Decided in [ADR-0011](docs/decisions/0011-design-layer-copied-in.md), not yet built — see Roadmap. |
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

Most of what CI checks, in one command:

```bash
pnpm verify   # guards, lint, types, tests
```

CI runs that, plus `pnpm build`, plus a second job for the database suite below. `verify`
deliberately excludes that suite, so a green `verify` is not a green repository.

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
password reset, email verification, roles and permissions, multi-tenancy, per-client
branding, a shared design layer in `packages/ui` (Tailwind and shadcn/ui, copied in rather
than depended on), a React Native client on the same identity service, and a list of the
sessions an account currently holds — each with where it was last used from, and a way to
end all of them at once.

A session here is held by whoever presents its cookie, bound to no address or device on
purpose: an address changes several times a day for an ordinary person and barely
inconveniences a thief, so a stolen refresh token is answered by rotation and reuse
detection ([ADR-0009](docs/decisions/0009-concurrent-refresh.md)) rather than by guessing
from where a request arrived. Binding a session to a key it must prove it holds, rather
than to a place, is the real answer, and it is a feature rather than a line of code.
