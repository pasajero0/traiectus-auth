# ADR-0021: The credentials rate limit shares one bucket

**Status:** accepted
**Date:** 2026-09-03

## Context

`domain/credentials.ts` checks a password in equal time whether or not the address exists,
so an address nobody registered costs the same argon2id hash as a real one. Nothing capped
how many hashes `/v1/credentials/verify` would pay for per minute, and `@fastify/rate-limit`
sat in `package.json` unused.

The obvious wiring — register the plugin, cap this one route — was done first without a
`keyGenerator`, on the assumption that it would amount to one shared bucket: `sso-web` is
the route's only caller, gated by `requireInternalKey` (ADR-0007), so there is exactly one
party who can ever reach the handler that pays the hash. A code review caught that this
assumption was never made true. `@fastify/rate-limit`'s default key is `request.ip`, and
`trustProxy: true` in production means that reflects whatever address the request actually
arrived from — one bucket only if every call from `sso-web` happens to arrive from the same
address, which nothing guarantees on a platform that can run a caller's outbound request
from more than one egress point. The code and its own comment claimed a property the
implementation didn't have.

## Decision

**`credentials.ts`'s rate limit uses a fixed `keyGenerator`, not the library's default.**
One constant key, so the 10-per-minute cap is what it was meant to be: the whole service's
budget for this one endpoint, not a budget that happens to fragment across however many
addresses a caller's requests arrive from.

This is deliberately not a per-caller limit. `requireInternalKey` already answers "is this
sso-web" before the rate limit is ever consulted; what the limit defends is CPU spent on a
hash, which is the same cost regardless of which address asked for it.

## Consequences

- The cap is real: at most ten argon2id hashes per minute, full stop, regardless of how a
  request's `request.ip` resolves.
- The bucket is still shared, which is the tradeoff named when this line was first written
  and remains true here: a flood against one login attempt throttles unrelated concurrent
  ones too, because there is no way today to tell them apart. Forwarding the real browser
  address from `sso-web` to `sso-api` would let a future `keyGenerator` key on that instead
  — tracked as backlog, not this decision.
- Nothing here defends a specific account against being guessed at; it defends the instance
  against paying for guesses. Per-account brute-force protection needs the same
  per-address information the paragraph above names as missing.

## Alternatives considered

**The library's default, `request.ip`.** What shipped first, and the reason this ADR
exists: it does not produce one bucket, only one bucket *if* every call arrives from the
same address, which is an assumption about infrastructure this repository doesn't control
and shouldn't assume. Silently wrong is worse than explicitly limited.

**Key on the submitted email.** Rejected for now on the same grounds ADR-0021's Context
raises about the caller: `sso-web` is the only party that can reach this route, so keying on
anything the request carries — email included — still funnels through one caller's traffic
shape, and the CPU-cost concern this limit exists for doesn't care which address is being
tried, only how many hashes run per minute. Worth revisiting once per-address information
travels with the request at all (see the IP-forwarding backlog item).
