# ADR-0001: Three sessions, three owners

**Status:** accepted
**Date:** 2026-08-28
**Amended by:** [ADR-0008](0008-no-token-reaches-the-browser.md) — ③, no token reaches the
browser; [ADR-0009](0009-concurrent-refresh.md) — how rotation behaves under concurrency.

## Context

"Sign in once, be signed in everywhere" is the claim the project exists to demonstrate,
and it is the claim most often made without a mechanism behind it. Before any table is
created, it has to be settled *what remembers the user*, *who owns each cookie*, and
*what logging out actually revokes*.

The deployment forces the question. The identity service runs on one host, each client on
another. A cookie set by the identity service is readable only by the identity service.
No amount of configuration changes that. So a client cannot be handed a session by the
service; it has to establish its own.

## Decision

Three distinct things carry state, each owned by exactly one party.

```
                     ┌────────────────────────────────┐
   ①  SSO SESSION    │ cookie traiectus_sso           │  owner: sso-web
      "who is at     │ opaque id → row held by sso-api│  (row in sso-api's DB)
       this browser" │ hard 7d · sliding 24h · revocable
                     └────────────────────────────────┘
                                   │ consulted by GET /authorize
                                   ▼
   ②  AUTHORIZATION  ┌────────────────────────────────┐
      CODE           │ single use · 60s · bound to    │  owner: sso-api
                     │ client_id + exact redirect_uri │
                     └────────────────────────────────┘
                                   │ exchanged server-side at POST /v1/token
                                   ▼
   ③  PRODUCT        ┌────────────────────────────────┐
      SESSION        │ refresh token, rotating family │  owner: each client's
                     │ cookie <client>_session        │         own web server
                     │ access token: server-side only │
                     └────────────────────────────────┘
```

**① The SSO session** is what makes the second sign-in invisible. It is an opaque
identifier in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `sso-web`'s own host,
backed by a row in `sso-api` so it can be revoked. Hard limit seven days from creation,
never extended; sliding limit twenty-four hours from last use. `GET /authorize` consults
it: if it is valid, an authorization code is issued and the browser goes straight back to
the client without a form.

**② The authorization code** never reaches client-side JavaScript. It arrives at the
client's server on a redirect and is exchanged there. Single use, sixty seconds, bound to
the requesting `client_id` and to the exact `redirect_uri` from the allowlist. A second
presentation is an attack, not a retry, and is logged as one.

**③ The product session** belongs to the client. `<client>-web`'s server performs the
exchange, receives an access/refresh pair, and seals **both** into **its own**
`HttpOnly; Secure; SameSite=Lax` cookie on its own host. Neither token reaches browser
JavaScript, web storage, or a URL — see [ADR-0008](0008-no-token-reaches-the-browser.md).
Refresh tokens rotate on every use; presenting a rotated-away token revokes the entire
family, on the reasoning that the only way to hold a used refresh token is to have taken
it — outside the ten-second same-client replay window that keeps a browser's own
concurrent refreshes from revoking themselves, see
[ADR-0009](0009-concurrent-refresh.md).

**Access tokens are self-contained and actually travel.** `sso-api` signs them with EdDSA.
`<client>-web`'s server attaches one to every call against `<client>-api`, which verifies
the signature locally against a public key in its environment and never calls back. This is
what makes a product a resource server rather than a front end: the token is checked by
someone other than its issuer, and the mobile client in v2 is a peer of the browser rather
than a special case. Key rotation and JWKS are out of scope and named in the Roadmap; the
public key is configured statically.

**Lifetimes:** access 5 minutes, refresh 14 days with rotation, SSO session 7 days hard /
24 hours sliding.

**Any change to credentials revokes the same things a logout does.** A password change —
and password reset, when it arrives from the Roadmap — invalidates every refresh family and
the SSO session, on every device. A session that outlives the password changed to end it was
never really revoked.

**Logging out** revokes the SSO session and every refresh family belonging to that user.
Already-issued access tokens are not recalled — nothing can recall a self-contained token —
so they expire on their own, within five minutes. That is the reason the access lifetime is
five minutes and not an hour, and the README says so rather than implying instant global
logout.

## Consequences

- The redirect flow must be plain top-level `GET` navigation. `SameSite=Lax` withholds the
  cookie from a cross-site `POST`, and browser storage partitioning makes silent checks in an
  iframe unreliable. No hidden-iframe renewal, ever.
- Three cookie names coexist on `localhost` during development, so they are explicitly
  distinct: `traiectus_sso`, `harbor_session`, `beacon_session`.
- `<client>-api` is called by its own web server rather than by the browser (ADR-0008), so
  it needs no CORS at all. It accepts bearer tokens only, holds no session and sets no
  cookie, so it has no CSRF surface. The surface moves to `<client>-web`, where one
  `SameSite=Lax` cookie and an `Origin` check cover it.
- Validating the SSO session crosses the network: `sso-web` on Vercel asks `sso-api` on
  Render. The uptime pinger is therefore a requirement, not a nicety — without it the first
  sign-in of the day waits out a cold start.
- Revocation is only as fast as the access lifetime. Stated plainly in the README.

## Alternatives considered

**A shared cookie on a parent domain.** Both hosts under one registrable domain, one cookie
for everyone. Simple, and it is not single sign-on: it is one session shared by trusting
parties. It also cannot work on `onrender.com` and `vercel.app`, which are public suffixes,
and it collapses the boundary the project is built to demonstrate.

**Opaque access tokens with an introspection endpoint.** Revocation becomes immediate, which
is a real advantage. Rejected because every product request would then call the identity
service, making it a synchronous dependency of both products. Immediate revocation is bought
instead with a short access lifetime.

**A backend-to-backend heartbeat, product → identity service, to keep the SSO session alive.**
Necessary in a design without refresh tokens, where the SSO session is the only thing being
extended. Unnecessary here: refresh rotation already extends the product session on activity,
and the SSO session's sliding window is refreshed whenever a client next passes through
`/authorize`.
