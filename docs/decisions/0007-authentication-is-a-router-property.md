# ADR-0007: Authentication is a property of the router, not the handler

**Status:** accepted
**Date:** 2026-08-31

## Context

Every route in this repository has an audience, and the audiences are genuinely different:
a sign-in page is open to anyone, product data needs a person's access token, the internal
endpoints behind `sso-web` need the shared secret, and `POST /v1/token` needs a client's
credentials.

The dangerous failure is not a weak check. It is an absent one. A handler that forgot its
check is, at a glance, indistinguishable from a handler that never needed one — both are a
function that reads some data and returns it. Review confirms what is present and is blind
to what is missing, and the omission then survives exactly as long as nobody thinks to look
for it. This is the single most common way an otherwise careful service ends up serving
everybody's rows to anybody.

## Decision

A route cannot be registered without naming its audience. There are four constructors, one
per audience, and each installs its check before any handler runs.

```ts
// apps/harbor-api/src/routes/projects.ts
export const projects = principalRouter()   // a verified access token, or 401
  .get('/v1/projects', …)

// apps/sso-api/src/routes/health.ts
export const health = publicRouter()        // unauthenticated, stated out loud
  .get('/health', …)

// apps/sso-api/src/routes/token.ts
export const token = clientRouter()         // client_id + client secret
  .post('/v1/token', …)

// apps/sso-api/src/routes/internal/sessions.ts
export const sessions = internalRouter()    // the shared secret from sso-web
  .post('/internal/sessions', …)
```

A bare framework instance is never mounted on an application. A test walks the assembled
route table and fails on any path that did not arrive through one of the four constructors,
so the guard covers routes that have not been written yet — which is the only kind of guard
worth having against forgetting.

Two rules ride along with it:

- **The principal comes only from a signature this service verified itself.** No inbound
  header, query parameter or body field ever contributes to identity. A service must never
  trust a field it also produces.
- **`publicRouter()` is the only way to serve an unauthenticated request**, so the first
  line of every route file answers "who may call this".

## Consequences

- Adding an endpoint forces a decision about its audience, in the same line that creates it.
  Choosing the wrong audience is still possible — but that is a mistake review can see,
  which the omission was not.
- The four constructors are the complete list of ways into this system. Enumerating the
  attack surface is reading four call sites, not auditing every file under `routes/`.
- `sso-api` mounts three of the four; the product APIs mount `principalRouter()` and, for
  health, `publicRouter()`.
- Authorisation beyond authentication — roles, ownership — stays out of scope and in the
  Roadmap. Where a route serves per-user data the handler filters by the principal's
  subject. The router establishes **who is calling**, never **what they may have**, and the
  two are not conflated to make the router look more capable than it is.
- Route files get slightly more ceremony than a small service would otherwise need. That is
  the point being bought.

## Alternatives considered

**A check inside each handler, or a decorator on the service method.** Reads well and sits
next to the work. Rejected on two grounds: it is one keystroke away from absent, and it puts
the boundary at the wrong layer. The boundary is the HTTP edge, where untrusted bytes
arrive — not the function that happens to be called next, which by then has no idea whether
anyone checked.

**One global middleware with a list of exempt paths.** Closes the omission and is less
ceremony. Rejected because the exemption list is edited by whoever is adding the exception,
in the same commit as the exception, and grows without ever being read as a security change.
A public route should be declared where it is defined, not in a file nobody opens.

**Review and a checklist.** Review sees what is written. The failure here is what is not.
