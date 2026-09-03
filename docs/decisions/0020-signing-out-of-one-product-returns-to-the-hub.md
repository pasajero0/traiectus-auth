# ADR-0020: Signing out of one product returns to the hub

**Status:** accepted
**Date:** 2026-09-03

## Context

A product's own "Sign out" cleared only its own cookie, and testing it made the gap
obvious: click Sign out on Beacon, land on `/`, and the still-live SSO session silently
signs the browser back in through the same zero-click path ADR-0019 built. From the
outside, sign-out looked like it did nothing.

The first shape tried was making a product's sign-out cascade all the way to revoking the
SSO session — clear the local cookie, then redirect on to `sso-web` to end `traiectus_sso`
too. It closed the "looks like a no-op" gap, but wrongly: one click on one product now
ejected the browser from the entire identity layer and landed it on a bare `/login` form,
with no memory of what had just happened or what else was reachable. A local action was
producing a global, silent, unexplained consequence.

What was actually wanted became clear once tried: leaving one product should land
somewhere that makes sense of having left it — a hub, signed in at the SSO level, showing
what is still reachable — not a stranger's login form. Ending the SSO session itself is a
separate, larger act, and belongs to a place a person deliberately chose, not a side
effect of leaving one tab of it.

`sso-web`'s own dashboard (ADR-0019's counterpart on the identity service, `page.tsx` at
`/`) already does exactly this when the SSO session is alive: lists connected products,
offers its own sign-out. It had no reason to be bypassed.

## Decision

**A product's "Sign out" clears its own cookie and returns the browser to `sso-web`'s
dashboard — not to `sso-web`'s `/logout`.** The SSO session is untouched. From the
dashboard, a person can walk straight into any other connected product — the SSO session
being alive is what makes that silent, the same mechanism ADR-0019 built for the first
visit — or take the dashboard's own explicit "Sign out", which is the only action that
ends `traiectus_sso`.

`/logout` stays `POST` only, `Origin`-checked, reachable solely from the dashboard's own
same-origin form. A `GET` variant, reached by a product's redirect with an allowlisted
`returnTo`, was drafted and discarded before it had a caller — see Alternatives.

## Consequences

- Two distinct exits, matching two distinct intentions: leaving one product (local cookie
  gone, SSO session alive, land on the hub) and leaving the identity layer itself
  (`traiectus_sso` revoked, land on the hub's own signed-out state, a login link).
- A product visited again directly — not through the hub — still finds the SSO session
  alive and signs back in silently. That is not a bug; it is what "left one product, not
  the session" means. Ending the session is what stops it, and nothing short of visiting
  the hub and choosing to end it does.
- The refresh family a product already holds is untouched by either exit. It rotates on
  its own terms until single logout (07/09) revokes it too.

## Alternatives considered

**A product's sign-out ends the SSO session directly**, via a `GET /logout` reached by
redirect after the product's own `Origin`-checked `POST`, with `returnTo` checked against
the registered `homeUrl` allowlist — the same split `/authorize` already uses between a
same-origin `POST` and a cross-site `GET`. Built and then discarded: it does fix "sign-out
looks like a no-op," but it answers the wrong question. Clicking Sign out on one product
should mean leaving that product, not silently ending every session everywhere; the
dashboard is what makes ending everything a choice instead of a side effect.

**Land the cascade on the dashboard instead of `/login`.** Closer, and briefly considered.
Rejected because it does not fix the actual problem: the SSO session would still die as a
side effect of a local action, so the dashboard the person lands on would show them signed
out — not what clicking one product's Sign out should mean.
