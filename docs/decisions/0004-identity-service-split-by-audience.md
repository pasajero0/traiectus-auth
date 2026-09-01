# ADR-0004: The identity service is split by audience, not by layer

**Status:** accepted
**Date:** 2026-08-28

## Context

The identity service has two faces: pages a person looks at (sign in, register) and
endpoints other machines call (`/v1/token`, and the internal calls behind the pages).
Splitting it into a web half and an API half makes it consistent with the client products
and lets every user interface in the repository be React, sharing `@traiectus/ui`.

But the split runs into a hard browser constraint. The SSO session cookie must be readable
by whatever handles `/authorize` — that endpoint's whole job is to decide whether this
browser is already signed in. Cookie and endpoint must therefore share an origin, and one
naive split breaks that: a page on origin A calling `fetch` to origin B, whose response
tries to set a cookie, is a third-party cookie write. Safari blocks it, Chrome and Firefox
partition it. A sign-in that works this way does not work at all.

## Decision

Split by **audience**, not by layer.

```
sso-web  ← browsers                    sso-api  ← machines
─────────────────────────────          ─────────────────────────────
sign-in and registration pages         users, argon2id, credentials
POST /login  (own route handler)       SSO session rows
GET  /authorize                        authorization codes
POST /logout                           POST /v1/token, refresh rotation
owns cookie traiectus_sso              reuse detection
                                       the database
```

`sso-web` is the browser-facing half. It owns the session cookie on its own origin and
reaches `sso-api` from its own server, over HTTP, with a shared secret. The browser never
contacts `sso-api` directly, so no cookie is ever set across origins.

`sso-api` is machine-facing. Its callers are `sso-web` and the client products' servers
(`POST /v1/token` is a server-to-server call carrying a client secret). It renders no HTML
and reads no cookie.

## Consequences

- No cross-origin cookie writes anywhere in the design, and no login-challenge handshake
  between the two halves.
- Every user interface in the repository is React on Next.js, including the sign-in pages,
  so `@traiectus/ui` serves all of them and the visual polish pass is one job rather than
  two. A server-side template stack is avoided entirely.
- A shared secret now exists between two of our own services. In a project whose subject is
  security this is a surface, not a detail: it is configuration-only, never in the
  repository, and `sso-api` treats a missing or wrong key as an unauthenticated request.
- Validating a session crosses the network, Vercel to Render. The uptime pinger becomes a
  requirement — see ADR-0001.
- Seven deployment targets in total including the database. Environment configuration is the
  largest operational cost of this decision.

## Alternatives considered

**One unified service** — Fastify serving both the API and server-rendered sign-in pages on
a single origin. Fewer moving parts, no shared secret, no network hop to validate a session.
Rejected because it puts a second templating stack in a repository where everything else is
React, which makes the visual layer two jobs instead of one, and because it reads as an
exception in an otherwise uniform layout.

**The challenge handshake**, as Ory Hydra does it: `/authorize` stays on the API, which
redirects to a separate login application with a challenge, and that application posts the
result back. Legitimate and proven. Rejected because it requires designing and explaining a
protocol between two of our own services — work that demonstrates nothing the project set
out to demonstrate.
