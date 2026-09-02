# ADR-0016: PKCE on every authorization request

**Status:** accepted
**Date:** 2026-09-02

## Context

PKCE was on the Roadmap, out of scope, listed beside public clients — which is where it
came from historically and no longer is.

The standards moved. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700), the current
Security BCP, requires PKCE for public clients and **recommends** it for confidential ones.
Our clients are confidential — each is a server holding a secret — so the requirement does
not bind us. But OAuth 2.1 makes PKCE mandatory for **every** client type, public and
confidential alike, and the large providers are already implementing it that way.

What PKCE prevents is authorization code injection: an attacker who obtains a code —
from a log, a referrer, a shared device, a compromised redirect — redeems it. A client
secret does not stop that, because the attacker is not redeeming it as a different client;
the honest client's own server does the redemption for them, on a code the attacker planted
in their browser. RFC 9700 asks that every code be bound to the client instance, the device
and the transaction that started it. PKCE is how that binding is done without inventing one.

The cost is small and lands on a day already scheduled for authorization codes. The cost of
not doing it is that the artifact demonstrates the code flow as it was recommended in 2019.

## Decision

**Every authorization request carries PKCE. `S256` only.**

- `GET /authorize` requires `code_challenge` and `code_challenge_method=S256`. A missing
  challenge, or `plain`, is `invalid_request` — there is no downgrade path, because a
  downgrade path is the attack.
- The challenge is stored on the authorization code row and travels nowhere else.
- `POST /v1/token` requires `code_verifier`, recomputes `BASE64URL(SHA256(verifier))` and
  compares it to the stored challenge. A mismatch is refused and the code is consumed
  regardless, since a code presented with the wrong verifier is not a retry.
- The verifier is 32 bytes from `node:crypto`, minted per transaction by the client SDK and
  held in the client's own session, never in the browser.

This moves PKCE off the Roadmap and into the shipped scope.

## Consequences

- `@traiectus/auth-client` mints and holds the verifier, so the mechanism is exercised by
  the SDK rather than described in the README.
- Both client products get it for free; nothing about it is per-client configuration.
- The authorization code table carries `code_challenge` from the migration that creates it,
  so nothing has to be added to live rows later.
- A client that skips PKCE cannot obtain a code at all. That is deliberate: an optional
  countermeasure is one that some integration eventually turns off.
- The Roadmap still names public clients — PKCE and public-client support were bundled
  there, and only PKCE is being taken.

## Alternatives considered

**Leave it on the Roadmap, as scoped.** Defensible against RFC 9700 to the letter, since our
clients are confidential. Rejected because the letter is behind the practice: OAuth 2.1
requires it of confidential clients too, and a public artifact about authorization is read
against what is current, not against what was minimally required.

**Support `plain` as well as `S256`** for symmetry with RFC 7636. Rejected: `plain` exists
for devices that cannot compute SHA-256, none of which are in this system, and supporting it
means an attacker can request it.
