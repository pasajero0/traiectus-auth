# ADR-0015: Expired rows have an owner

**Status:** accepted
**Date:** 2026-09-02

## Context

`sso_sessions` shipped on 02/09 with a hard seven-day limit and nothing that deletes a row.
A session is dead to the application after seven days and alive in the table for ever. There
is no index on `expires_at`, so even finding the dead rows is a sequential scan.
`refresh_tokens` would repeat the same design at a much higher rate: a row per rotation,
which for an active session is a row every five minutes.

Two defects that are mild alone multiply: a table that only grows, searched by a query that
only scans. Neither shows up in development, and both show up in production gradually, on
the hot path.

Logical expiry is not deletion, and deciding who deletes is part of designing a table with a
lifetime — not a thing to be arranged once it hurts.

## Decision

**Garbage is a row whose hard expiry passed more than seven days ago, or that was revoked
more than seven days ago.** The week is deliberate: an incident is investigated after it is
noticed, and the rows are the evidence.

**A lazy in-process sweeper collects it.** At most once an hour, started by an ordinary
request but not awaited by it, so nothing on the hot path pays for maintenance.

**Every table with a lifetime is created with an index on the column the sweeper filters**,
in the same migration that creates the table.

**The same pass clears a closed replay window** — `successor_ciphertext` where `replay_until`
has passed (ADR-0009 ③). It runs without an index on `replay_until`: an hourly sequential
scan of a small table, off the hot path, is cheaper than an index maintained on every write
for a query nothing else makes. That trade is worth revisiting when the table is large enough
for it to be measured rather than guessed.

## Consequences

- The service sleeps on the free tier, so sweeping happens when there is traffic — which is
  exactly when rows are being created. A service with no traffic accumulates nothing.
- No secret leaves the deployment: an external scheduler calling an internal route would
  need the internal key, and it would live in that scheduler's settings.
- A sweep that fails is logged and retried an hour later. It holds no locks anyone waits on.
- `sso_sessions` needs its `expires_at` index added by a follow-up migration, since it
  shipped without one. Additive, so it is safe against the running release.
- Deleting a token row cascades nothing: a family outlives its tokens and is swept on its
  own terms.

## Alternatives considered

**An external cron calling an internal route.** Exact schedule, visible failures, no code in
the request path. Rejected because it puts `INTERNAL_API_KEY` into a third-party scheduler
alongside the uptime pinger, which needs no credential at all.

**`pg_cron` in the database.** The right answer on a database that offers it. Render's free
Postgres does not.

**Deleting on the hot path** — a small delete alongside each rotation. Rejected: it makes a
user's sign-in pay for maintenance, and the cost lands on whoever is unlucky rather than on
nobody.

**Waiting until it is a problem.** Named here because it is the default, and because the
moment it becomes a problem is the moment it is most expensive to fix.
