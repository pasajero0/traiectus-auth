# ADR-0008: No token reaches the browser

**Status:** accepted
**Date:** 2026-08-31
**Amended by:** [ADR-0018](0018-the-one-get-that-produces-something.md) — the third
mitigation below, "no state-changing GET", is a rule for client applications; `/authorize`
mints a code on a navigation and says why that is not the same thing.
**Amends:** ADR-0001, section ③ — the access token no longer lives in browser memory.

## Context

ADR-0001 kept the access token in the browser's memory and had the page attach it to every
call against `<client>-api`. Memory is meaningfully better than web storage: it does not
survive a reload, another tab cannot read it, and it is not sitting there waiting to be
collected later.

It is still not good enough for this repository. A token held in JavaScript is reachable by
every script on the page, including the fourth-level dependency nobody audited. It is one
debugging session away from a query string and one analytics wrapper away from somebody
else's server. "In memory" was the last place in this design where the careful answer had
been traded for the conventional one, and this project's whole claim is that it does not do
that.

The requirement is therefore absolute: no token in browser JavaScript, none in web storage,
none in a URL — and consequently none in browser history, in a `Referer` header, in an
access log, or in a crash report.

## Decision

**Tokens exist only on servers.** On the browser's side of the system, `<client>-web`'s
server is the only party that ever holds one.

```
  browser ──── cookie ────► <client>-web ──── Bearer ────► <client>-api
          (carries no token) │  holds both tokens
                             └── client credentials ────► sso-api  POST /v1/token
```

- **The client's session cookie holds an AEAD-sealed envelope** — access token, its expiry,
  and the refresh token — encrypted with a key in `<client>-web`'s environment.
  `HttpOnly; Secure; SameSite=Lax; Path=/`, and carrying the `__Host-` prefix in production
  (plain names locally, where `Secure` cannot apply over http). `HttpOnly` keeps it away
  from scripts; the encryption keeps it away from anyone who obtains the cookie without also
  having the key.
- **The browser calls its own origin.** Requests go to `<client>-web/api/…` carrying nothing
  but that cookie. The BFF unseals, attaches `Authorization: Bearer …`, and forwards to
  `<client>-api`. **An `Authorization` header arriving from the browser is dropped, not
  overwritten** — see ADR-0007: a service never reads a field it also produces.
- **No web storage at all.** Not for tokens, not for anything else:
  `scripts/check-boundaries.mjs` rejects `localStorage`, `sessionStorage` and `indexedDB`
  anywhere under `apps/` or `packages/`. A blanket rule needs no judgement at the moment
  somebody is in a hurry.
- **Nothing secret goes in a URL.** The one unavoidable exception is the authorization code,
  which arrives at the client's callback as a query parameter — that is what the redirect
  flow is. It is contained rather than tolerated: single use, sixty seconds, exchanged
  server-side the moment it lands, answered with a `303` to a clean path (an HTTP redirect
  leaves no browser-history entry), `Referrer-Policy: no-referrer` on that response, and
  request logging that never includes a query string.

**Between backends there are no cookies at all, and `HttpOnly` means nothing there.** It is
a browser flag; a server-to-server call carries no cookie jar, so asking for `HttpOnly` on
those hops asks for the wrong protection. They are secured differently and deliberately:
`sso-web → sso-api` carries the internal shared secret in a header,
`<client>-web → sso-api /v1/token` carries client credentials — both over TLS, both from
configuration only, never in a URL, never logged, and both treated by `sso-api` as
unauthenticated when missing or wrong.

## Consequences

- **`<client>-api` is still a real resource server.** The bearer token is still verified by
  someone other than its issuer, still crosses a deployment boundary, and still triggers no
  callback to `sso-api`. What changed is which of our servers presents it. Every reason
  ADR-0002 gave for splitting a product into `-web` and `-api` survives unaltered.
- **The mobile client in v2 is untouched, and becomes the reason the API stays bearer-only.**
  It keeps its tokens in the device keychain — the platform's equivalent of an HttpOnly
  cookie — and calls `<client>-api` directly. A native application can hold a token safely.
  A browser page cannot. The asymmetry is the honest one.
- **A CSRF surface appears where there was none.** The browser now authenticates to
  `<client>-web` with a cookie. Mitigated by `SameSite=Lax`, an `Origin` check on every
  state-changing request, and no state-changing `GET`. `<client>-api` still holds no cookie
  and still has no CSRF surface, so the risk is concentrated in one place instead of spread
  across three.
- **One extra hop per product request**: browser → `<client>-web` → `<client>-api`, both on
  Vercel. Paid deliberately, and the reason the BFF must stay thin — unseal, attach,
  forward, and nothing else (ADR-0005).
- `@traiectus/auth-client/react` carries no token. Its hooks report who is signed in and
  call the BFF's own paths; there is no access-token hook because there is no access token
  in the browser to hook.
- The sealed cookie is sent on every request to the client's origin. An EdDSA access token
  plus a refresh token, sealed, stays well inside the 4 KB limit, but it is not free.
- A cookie the server rewrites is a cookie that changes during ordinary data responses,
  because refresh rotation happens there. See ADR-0009.

## Alternatives considered

**The access token in browser memory**, as ADR-0001 first had it. Standard practice, one hop
fewer, and it makes the bearer token visibly travel from browser to resource server — the
mechanism the repository exists to show. Rejected because visibility is a documentation
problem and XSS is a security one. The same mechanism is on display one server later, and a
diagram can show it just as well.

**A server-side session store** — an opaque cookie id, tokens in a table — instead of a
sealed cookie. Revocation becomes immediate and the cookie shrinks to nothing. Rejected
because it gives every client web application a database, which is precisely what ADR-0002
says clients do not have, and turns two stateless deployments into stateful ones to buy
revocation that a five-minute access lifetime already bounds.

**Refresh in the cookie, access re-fetched from `sso-api` on every page load.** One less
secret at rest in the browser, at the cost of a token round trip on every navigation and a
synchronous dependency on a service that sleeps on Render's free tier.
