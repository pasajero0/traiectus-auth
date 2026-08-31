# ADR-0005: A product's logic knows nothing about transport

**Status:** accepted
**Date:** 2026-08-28

## Context

Each product will be reached by more than one kind of caller. Today a browser calls
`harbor-api` with a bearer token held in memory. In v2 a React Native client calls the same
endpoints with a token from the device keychain. The two must not diverge — a mobile client
that needs its own endpoints is not a client of the same product, it is a second product.

## Decision

Inside every `*-api`, the layer that does the work takes plain arguments and returns plain
values. It imports no framework, receives no request object, and reads no header.

```
apps/harbor-api/src/
├─ index.ts            the HTTP framework, and nothing else
├─ routes/projects.ts  parse · authenticate · delegate · serialise   (thin)
└─ domain/projects.ts  what the product actually does                (no HTTP)
```

`routes/` authenticates with `@traiectus/auth-client/resource`, which verifies the token
signature locally, and then calls `domain/`. Anything that grows inside `routes/` becomes
invisible to callers that arrive by another door, so it stays thin on purpose.

The same rule holds in `*-web`: `src/server/` is transport-free and marked `server-only`,
and both the page and the route handler call into it.

## Consequences

- The HTTP framework is a single file. Choosing it — or changing it — is not a rewrite.
- The mobile client in v2 needs no new endpoints, only a different way of obtaining a token.
- Product API paths are versioned (`/v1/…`) from the first commit, because a released mobile
  application cannot be asked to follow a rename.
- `@traiectus/contracts` carries product response types as well as the identity protocol, so
  a web client and a mobile client cannot disagree about a shape.

## Alternatives considered

**Logic inside route handlers**, the ordinary shape for a small service. Rejected because
the second caller is already scheduled: what lives in a handler would have to be moved
before the mobile client could exist, and moving it later is how two callers quietly end up
with two behaviours.
