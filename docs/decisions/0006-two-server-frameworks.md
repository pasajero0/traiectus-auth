# ADR-0006: Fastify for the identity service, Hono for the product APIs

**Status:** accepted
**Date:** 2026-08-28

## Context

Two kinds of server exist in this repository and they have little in common.

`sso-api` is long-lived and stateful: it holds a connection pool to Postgres, hashes
passwords with argon2id, signs tokens, and enforces rate limits across requests. It runs on
Render, where a process stays up between requests.

`harbor-api` and `beacon-api` are thin and stateless. Each verifies a token signature
against a public key and returns JSON. They hold no connections, no sessions, no cookies.
They run on Vercel, where a request may well arrive at a cold instance.

Putting both on Render was rejected first: three free-tier services that sleep after fifteen
minutes would mean the live demo — the part people actually click — waiting out a cold start
on nearly every visit.

## Decision

`sso-api` uses **Fastify** on Render. The product APIs use **Hono** on Vercel.

## Consequences

- Two server frameworks in one repository, which has to be worth explaining, and is: the
  services have different lifetimes, different hosts, and different jobs.
- Hono's Web-standard `Request`/`Response` model fits Vercel's runtime directly and starts
  fast, which is what a stateless resource server needs.
- Fastify's plugin ecosystem — cookies, rate limiting, structured logging — is what the
  identity service needs and what Hono would have to reimplement.
- The cost is bounded by ADR-0005: the framework touches `src/app.ts` and `src/routes/`
  only. `src/domain/` and `@traiectus/auth-client/resource` are framework-free, which the
  boundary guard enforces, so a framework change is a small file rather than a rewrite.

## Alternatives considered

**Fastify everywhere.** One framework to learn and one set of idioms. Rejected because
Fastify does not fit Vercel's request model without an adapter, and the alternative host
sleeps.

**Next.js route handlers as the product APIs**, with no pages. One framework, deploys to
Vercel trivially. Rejected because a Next.js application serving no pages is a confusing
thing to read, and reading is what this repository is for.
