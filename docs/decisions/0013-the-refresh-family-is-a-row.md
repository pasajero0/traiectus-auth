# ADR-0013: The refresh family is a row of its own

**Status:** accepted
**Date:** 2026-09-02
**Amends:** [ADR-0009](0009-concurrent-refresh.md) — the column list in its Consequences.

## Context

ADR-0009 puts `family_id` on the token row and says nothing about where revocation lives.
The obvious reading is a `revoked_at` on every token, and revoking a family is then

```sql
UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1
```

which touches as many rows as there have been rotations. Under `READ COMMITTED` an `UPDATE`
selects its rows from the snapshot taken when the statement began. A rotation that commits
while that statement runs inserts a successor the statement never sees. **A revoked family
can be left holding one live token** — precisely the outcome reuse detection exists to
prevent, reached by the mechanism meant to prevent it.

Revocation is a fact about the family. Storing it on every member makes a property of the
whole into N copies that can disagree.

## Decision

**`refresh_families` is its own table** — `id`, `user_id`, `client_id`, `created_at`,
`revoked_at`, `revoked_reason`. `refresh_tokens` keeps `family_id` and loses `user_id` and
`client_id`, which belong to the family and were being copied into every rotation.

Revoking is one row. Rotation runs in a transaction that **takes the family row first**:

```
BEGIN
  SELECT … FROM refresh_families WHERE id = $1 AND revoked_at IS NULL FOR UPDATE
  UPDATE refresh_tokens SET consumed_at = now(), … WHERE token_hash = $2 AND consumed_at IS NULL …
  if a row came back → INSERT the successor
COMMIT
```

**Lock order is family, then token, everywhere, without exception.** Two locks taken in two
orders is a deadlock, and the second order is always introduced by someone who did not know
there was a first.

The lock is insurance rather than the mechanism, and saying so is the honest version. What
closes the revocation race is the *table*: every rotation reads the family, so a successor
issued a microsecond after a revoke is refused the moment it is presented. The lock buys
something narrower — a caller who loses waits for the winner instead of depending on
`READ COMMITTED` handing each statement a fresh snapshot. One of those is visible in the
code; the other is a footnote about isolation levels that the next reader has to already
know. The database tests pass with the lock removed, which is exactly why this paragraph
exists rather than a claim that it is load-bearing.

**The family carries `expires_at`, thirty days from its creation, and rotation refuses past
it.** Rotation issues a successor with a fresh fourteen-day life, so without a cap on the
family a session that is merely *used* never ends: fourteen days are measured from the last
rotation, not from the sign-in. OWASP ASVS 5.0 asks for a documented maximum session
lifetime with re-authentication at least every thirty days at L1, which is the level this
project targets and says so.

## Consequences

- Rotations inside one family serialise, which is what detection wants; rotations in
  different families do not contend at all.
- Revocation cannot race an in-flight rotation: the rotation is either already holding the
  family row, in which case the revoke waits and then sees the successor, or it is not, in
  which case it will find the family revoked.
- Logout (ADR-0001) revokes by `user_id` over families — a handful of rows rather than every
  token the user ever held.
- ADR-0009's Consequences list `refresh_tokens` as carrying `client_id`. It no longer does;
  the replay window's same-client comparison reads it from the family.
- Finding the family costs a read of the token row before the lock is taken. That read is
  not a check — the check stays in the `WHERE` of the `UPDATE`, so ADR-0009 ① holds.
- **A product session now has an end, and it is not the SSO session's end.** The SSO session
  dies after seven days; a family lives up to thirty. Someone signed in at Harbor can
  therefore go a month without typing a password, and does not become anonymous the moment
  the SSO session lapses — the next pass through `/authorize` simply shows a form again.
  ADR-0001 left this unsaid; it is said here.

## Alternatives considered

**`revoked_at` on each token.** One table, and the rotation predicate stays on a single
row. Rejected for the race above: it is not a performance argument but a correctness one.

**A families table without the row lock**, revocation checked inside the rotation. Cheaper,
and it is *correct* — a rotation that slips past a concurrent revoke produces a successor
that the next rotation refuses anyway, which the tests confirm. Kept the lock regardless,
for the reason above: the cost is one row-level lock per rotation within a single family,
and the return is that the concurrency argument can be read off the code.
The lock is what makes the two operations agree on an order.
