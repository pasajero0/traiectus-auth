# ADR-0017: The authorization response names its issuer

**Status:** accepted
**Date:** 2026-09-02

## Context

[RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) defines an `iss` parameter on the
authorization response so that a client can tell which authorization server produced the
code it is holding. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) recommends it.

It defends against mix-up: a client that knows more than one authorization server is tricked
into sending an honest code to an attacker's token endpoint. The client's secret does not
help, because the client hands the code over itself, to the wrong party. A second
authorization server is the precondition for the whole attack.

Today ours know exactly one, so the check would compare a constant against itself, and this
was nearly deferred on that ground. Two things change the answer.

**Social login is intended, and it lands at the identity service.** `sso-web` becomes an
OAuth client of Google and of GitHub; the products keep exactly one issuer, because
federating at each product would dissolve the single sign-on this repository exists to show.
The mix-up precondition therefore appears *inbound*, at `sso-web` holding two upstream
providers, well before it could appear at a product.

**`@traiectus/auth-client` is a public artifact.** Whoever points it at a second issuer
inherits whatever it does or fails to do.

## Decision

**`GET /authorize` includes `iss` on every redirect back to a client**, set to the identity
service's issuer identifier — its `https` origin.

**`@traiectus/auth-client` requires it.** A response carrying no `iss`, or an `iss` that does
not match the issuer the SDK is configured with, is refused before the code is exchanged.
Absent is a failure rather than a skip: a check that applies only when the parameter is
present is removed by deleting the parameter.

When federation arrives, `sso-web` applies the same rule to the responses it receives from an
upstream provider, as the client it will then be.

## Consequences

- One more query parameter on the redirect. It names a public service and is not a secret, so
  nothing in ADR-0008's rule about URLs is touched.
- The issuer becomes required configuration for the SDK rather than an optional field.
- The countermeasure is demonstrated rather than described, which is the difference this
  repository trades on.
- Social login is now committed to a shape: **upstream providers terminate at `sso-web`.** It
  remains on the Roadmap and unbuilt, but it is no longer an open architectural question, and
  the account-linking hazard it carries — a social identity claiming an address that already
  has a password — will need its own decision before any of it is written.

## Alternatives considered

**Defer until a second authorization server actually exists.** Correct in the narrow sense
that nothing is gained today. Rejected because the moment a second provider appears is the
moment every client is already deployed against the old behaviour, and because the whole
measure is roughly ten lines.

**Rely on `state`.** It binds a response to a request the client started, which is a
different property: `state` survives a mix-up intact, because the attacker relays the honest
response. It is necessary and it is not this.
