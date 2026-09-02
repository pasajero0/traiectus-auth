# ADR-0010: The sign-in page is server-rendered for the cookie, not for search engines

**Status:** accepted
**Date:** 2026-09-02

## Context

Next.js is normally chosen for the two things `sso-web` does not want. It will never be
indexed — every page it serves carries `noindex`, and a sign-in form has no content a
crawler should hold. It has four routes. A reader who knows why Next.js is usually reached
for will look at this application and reasonably conclude that it is here because the client
products are here, and that a static page with a small API behind it would have done.

The constraint is a different one, and it is not negotiable. What `sso-web` needs is a
server **on its own origin**.

- `/authorize` reads the SSO cookie, asks `sso-api` for a single-use code over the internal
  shared secret, and redirects to the client's `redirect_uri`. Every part of that is a
  server exchange; the secret cannot be in the browser (ADR-0008).
- The sign-in POST verifies credentials against `sso-api` and sets `traiectus_sso` —
  `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to this application's host. A cookie with
  `HttpOnly` set can be written and read only by a server answering on that host, which is
  exactly why ADR-0004 places the sign-in page in `sso-web` rather than in the API service.

So the question was never "single-page application or server rendering". It was "which
server", and the answer has to sit on the same host as the pages.

## Decision

`sso-web` is a **Next.js App Router application on Vercel**. Every route that touches the
session is a Server Component or a route handler, and **the sign-in page ships no JavaScript
at all** — a plain `<form>` posting to a route handler on the same origin.

Rendering happens on the server because the cookie does. Search engines are not a party to
this decision.

## Consequences

- **Signing in works with JavaScript disabled.** That is not a nicety here: it is the
  strongest possible statement of ADR-0008. A dependency cannot read what never arrives.
- One framework, one deployment target and one set of conventions across all four web
  applications, so `packages/ui` covers the sign-in page as well — which ADR-0011 depends on.
- The framework's SEO machinery goes unused. It costs nothing to leave unused, and pretending
  otherwise would be the argument this ADR exists to answer.
- A React runtime is served for what are, in the end, forms. Bounded deliberately: the pages
  are Server Components, the client bundle stays near zero, and any component that would
  force `'use client'` needs a reason.
- ADR-0005's rule holds unchanged — `src/server/` is transport-free and `server-only`, and
  the framework touches `src/app/` alone. As in ADR-0006, changing it later is a file, not a
  rewrite.
- `sso-web` and the client applications share a host and a framework but never a boundary:
  `check-boundaries.mjs` still refuses any import between them.

## Alternatives considered

**A static single-page application plus a small API**, the shape that "there is no SEO here"
suggests. Rejected because it does not remove the server. Browser JavaScript can neither set
nor read an `HttpOnly` cookie, so a server on `sso-web`'s origin is still required for
`/authorize`, for the sign-in POST and for sign-out — and now there are two deployable units
where there was one. The only version of this that genuinely removes the server moves the
code exchange into the browser, which ADR-0008 forbids without exception.

**Hono with `hono/jsx`**, server-rendering HTML on Vercel with no React runtime. Lighter than
Next.js, and it would have matched the product APIs' Web-standard model (ADR-0006). This was
close. Rejected because `packages/ui` is React and is used by every web application including
sign-in: the one page where a user is asked to trust what they are looking at would be the
one page assembled from different components. A visual seam at the moment somebody types a
password costs more than a React runtime does.

**Sign-in pages served by `sso-api`** on Fastify with a template engine — one deployment
fewer, and the credentials would never leave the service that checks them. Rejected by
ADR-0004: it collapses the split by audience that the whole identity service is arranged
around, and puts browser-facing HTML in the process that holds the database.
