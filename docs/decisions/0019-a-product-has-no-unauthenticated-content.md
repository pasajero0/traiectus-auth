# ADR-0019: A product has no unauthenticated content

**Status:** accepted
**Date:** 2026-09-03

## Context

`harbor-web` and `beacon-web` shipped with a public landing page — a paragraph and a
"Sign in" link — and only `/dashboard` and `/inbox` behind the middleware gate built in
ADR-0009's spirit. Arriving at either product cold meant a click before anything happened.

That click is real friction the identity service exists to remove. The claim this
repository demonstrates is "sign in once, be signed in everywhere" — a second application
should recognise an existing SSO session without the person doing anything, and even a
first visit should ask for a password exactly once, not once for the page and once for the
form. A "Sign in" link is a decision the browser can make for itself: there is nothing on
the other side of that click that depends on human judgement.

Three things this changes were already true but not written down:

- **Which product is asking is not new information to carry.** `client_id` on `/authorize`
  already tells `sso-api` and `sso-web` who sent the browser. Nothing needs to travel
  alongside it.
- **Returning to the exact route already works.** `startSignIn` seals `returnTo` into the
  transaction cookie on the product's own host, and `completeSignIn` reads it back after
  the exchange — a deep path like `/dashboard/42` survives the round trip today, not as a
  future addition.
- **A branded "signing you in…" screen was considered and declined.** The redirect chain
  is a server-side sequence of HTTP redirects with no client render in between; a loading
  page would mean introducing client JavaScript and a round trip where neither exists now,
  to smooth over a delay that is real only on a cold Render instance — and that delay
  already has its answer, the uptime pinger (Outstanding, README). The browser's own
  loading affordance covers the rest.

## Decision

**A product has no page that renders without a session.** Middleware gates the entire
application, not an enumerated list of protected paths:

```ts
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

The exclusion is deliberately an allowlist of infrastructure, not a list of protected
routes — the failure mode ADR-0007 names for authentication applies here too: a route added
later and left off an enumerated matcher fails open, silently. `/api/auth/*` is excluded
because it is the handshake itself; gating it would be a redirect loop.

There is no public landing page and no "Sign in" link. Visiting the product with no session
redirects straight to `/api/auth/login`, which redirects straight to `/authorize`. Visiting
with a live SSO session redirects straight back with a code, no form shown. A password is
typed exactly once — at `sso-web`, and only when no SSO session exists anywhere.

No loading page. The redirect chain stays what it is: HTTP, server-side, no client render.

## Consequences

- `(public)/page.tsx` is deleted from both `harbor-web` and `beacon-web`; the protected
  page becomes the product's root.
- The one remaining click in the entire flow is signing out — a deliberate act, not a step
  in getting in.
- A new page added to a product is protected by default. Making one public is an explicit
  exception in the matcher, reviewed the way an exception should be, rather than the
  default a route gets by being forgotten.
- The identity service's own cold start is still felt on the very first request of the
  day, inside a redirect a person cannot see progress on. The pinger is what prevents it,
  not a UI.

## Alternatives considered

**A client-rendered "Signing you in…" page**, checking session state after paint and
redirecting from there. Rejected in this session: it is a new mechanism — client JS on
every product, an extra round trip — bought to smooth a delay that has a cheaper fix
already in the plan.

**Gate an explicit list of protected paths, as it was.** Simpler to read at a glance.
Rejected because it fails exactly the way ADR-0007 warns about: a route that forgets to be
added to the list is indistinguishable, by inspection, from one that never needed
protecting.
