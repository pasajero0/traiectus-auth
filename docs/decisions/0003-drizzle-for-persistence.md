# ADR-0003: Drizzle for schema, queries, and migrations

**Status:** accepted
**Date:** 2026-08-28

## Context

The identity service needs PostgreSQL, typed access to it, and versioned schema changes
that can be applied to a live deployment. Hosting is Render's free tier, where the service
sleeps after inactivity and pays a cold start on the next request.

Migrations matter more than the query layer here: from day 2 the schema grows almost every
day — users, then refresh-token families, then authorization codes — and each change has to
reach production without hand-run SQL over a shell.

## Decision

Drizzle ORM with `drizzle-kit` for migrations. Migrations are generated as plain SQL files,
committed to the repository, and applied on deploy.

## Consequences

- No query engine binary to download and start, which keeps the cold start on Render as
  short as it can be on that tier.
- Migrations are readable SQL in the repository, which is worth something in a project meant
  to be read rather than only run.
- Queries stay close to SQL, so what the service does to the database is visible at the call
  site — appropriate for code whose security properties are the point.
- Less hand-holding than the alternative: no visual data browser, and relational queries are
  more explicit.

## Alternatives considered

**Prisma.** Better developer experience, a schema language that reads well, and a data
browser; also more widely recognised. Rejected on two grounds: the query engine adds weight
to exactly the cold start this deployment can least afford, and a generated client obscures
the SQL in a project where the database interaction is part of what is being demonstrated.

**Raw SQL with a thin driver.** Fewer moving parts and total control, but no derived types
and no migration tooling, which would mean writing the migration runner before writing the
feature. Not where the time should go.
