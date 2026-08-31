# ADR-0002: One repository, six deployments, enforced boundaries

**Status:** accepted
**Date:** 2026-08-28

## Context

The project is an identity service plus two client products, each of which has a web
application and its own API. That is six deployable units with six lifecycles, which
normally argues for separate repositories. But the project exists to be *read*: its purpose
is to show single sign-on end to end, to an engineer who will open exactly one link.

Separate repositories would be six places, and no single one of them shows the picture.

## Decision

One repository, six applications, three shared packages.

| Path | Deploys to | Faces |
|---|---|---|
| `apps/sso-web` | Vercel | browsers — sign-in pages, `/authorize`, the SSO cookie |
| `apps/sso-api` | Render | machines — users, passwords, codes, tokens, the database |
| `apps/harbor-web` | Vercel | browsers — product UI and its BFF |
| `apps/harbor-api` | Vercel | any client with a bearer token |
| `apps/beacon-web` | Vercel | browsers |
| `apps/beacon-api` | Vercel | any client with a bearer token |

Boundaries are enforced rather than assumed, by `scripts/check-boundaries.mjs` on every edit
and in CI:

- nothing outside `apps/sso-*` imports the identity service; clients reach it over HTTP
  through `@traiectus/auth-client`, exactly as a third party would;
- `apps/sso-*` imports nothing belonging to a client — clients are configured data;
- a `-web` and its `-api` never import each other; they share types through
  `@traiectus/contracts` and speak HTTP;
- `@traiectus/auth-client/resource` imports nothing from `next` or `react`, so a Hono API
  today and a different runtime tomorrow can both use it;
- files under a web application's `src/server` begin with `import 'server-only'`, so the
  build fails if browser code ever pulls one in.

Workspace packages are consumed as TypeScript source (`exports` points at `src/…`), so there
is no internal build graph to keep in sync.

## Consequences

- One link shows the identity service, the SDK, and two products consuming it.
- The boundary is verifiable by running a script, which is a stronger claim than separate
  repositories: separation by accident is indistinguishable from separation by design.
- Six deployments mean six sets of environment variables. Only `sso-api` is on Render; the
  rest are on Vercel, which does not sleep.
- These packages are not publishable to npm as-is. None of them is meant to be.

## Alternatives considered

**Separate repositories.** Honest about the deployment topology and closer to how this would
be organised inside a company. Rejected because the artifact's job is to be understood
quickly by someone who has not been asked to clone anything.

**One fullstack application per product**, with the product API as route handlers inside the
web application. Three deployments instead of six, and less configuration. Rejected for two
reasons. The access token would become decorative: a server that reads its own cookie and
queries its own database never needs one, so the mechanism the project is meant to
demonstrate would not actually run. And the mobile client in v2 would arrive as a special
case bolted onto a browser-shaped API, rather than as a peer of the web client.

**Clients sharing a single backend.** If only the identity service verifies access tokens,
the token never leaves its issuer and there is no resource server. That is a login form with
two front ends, not single sign-on.
