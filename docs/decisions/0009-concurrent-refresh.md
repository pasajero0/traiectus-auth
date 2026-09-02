# ADR-0009: Concurrent refresh — atomic rotation and a replay window

**Status:** accepted
**Date:** 2026-08-31
**Amended by:** [ADR-0013](0013-the-refresh-family-is-a-row.md) — the family is its own
table, and rotation takes its row first; [ADR-0014](0014-a-token-says-what-kind-it-is.md) —
a refresh token carries a `trr_` prefix; [ADR-0015](0015-expired-rows-have-an-owner.md) —
who deletes a consumed token, and when.

## Context

ADR-0001 makes reuse detection the exhibit: presenting a rotated-away refresh token revokes
the entire family, on the reasoning that the only way to hold a spent token is to have taken
it.

Under concurrency that rule turns on the person it protects. A page issues four requests at
once; the BFF finds the access token expired on all four and calls `POST /v1/token` four
times with the same refresh token. One succeeds. The other three are, by the letter of the
rule, an attack — and the user is signed out of a product they were actively using. A
security control that fires on ordinary behaviour does not survive contact with users: it
gets softened until it detects nothing, and the softening is never written down.

Serialising on the client side is not available. `<client>-web` runs as serverless functions
on Vercel, and simultaneous requests may land on separate instances that share no memory.
In-process coordination is a useful reduction and never a guarantee. Correctness has to live
in `sso-api`, which is single, stateful, and backed by Postgres.

## Decision

Three parts, in order of who is trusted for what.

**1. Rotation is one atomic statement.** Read, check, then write is three statements with a
window between them in which two callers both see an unconsumed token. Instead the consume
*is* the check:

```sql
UPDATE refresh_tokens
   SET consumed_at = now(), successor_id = $2
 WHERE token_hash = $1 AND consumed_at IS NULL
RETURNING family_id, user_id, client_id
```

Zero rows means either somebody else got there microseconds ago, or this token was spent
long ago and is being replayed. Distinguishing the two is the whole problem.

**2. A ten-second replay window.** When the update returns no rows, the row is read. If it
was consumed within the last ten seconds **by the same `client_id`**, this is a race and not
a theft: the caller is handed **the identical pair the winner received**, and nothing is
revoked. Outside the window, or from a different client, it is reuse — the family is revoked
and the event is logged as an attack.

Returning the *same* successor is what keeps detection honest. Both callers converge on one
token, so the family still has exactly one live holder at the next rotation. To serve the
replay, the successor's plaintext is held on the predecessor's row, encrypted with a key
that lives in `sso-api`'s environment and not in the database, and wiped when the window
closes. Everything else stored about a token is a SHA-256 hash: a refresh token is 256 bits
straight from `node:crypto`, so a fast hash is the correct one — there is nothing a slow
hash could add that the entropy has not already provided. (Passwords are argon2id and always
will be; the difference is that a password is not random.)

**3. The BFF refreshes early, and once per instance.** Holding the tokens (ADR-0008),
`<client>-web` knows the access expiry and never needs a `401` to discover it: it refreshes
when fewer than thirty seconds remain, before forwarding the request. Within one instance,
concurrent requests share a single in-flight refresh promise. Both measures cut the number
of races sharply. Neither is trusted to eliminate them.

**Reuse detection stays strict.** A refresh token stolen and used minutes or hours later
meets a consumed row far outside the window and takes the whole family down. If a theft is
used *inside* the ten seconds, attacker and victim receive the same token, diverge at the
next rotation, and the family is revoked then — detection delayed by one rotation, not lost.

## Consequences

- `refresh_tokens` carries `family_id`, `client_id`, `token_hash`, `consumed_at`,
  `successor_id`, and the two replay columns, from the migration that introduces refresh
  tokens.
- Every rotation rewrites the client's sealed session cookie (ADR-0008), including rotations
  that occur during an ordinary data request.
- **A live refresh token is briefly recoverable from `sso-api`'s database** — for ten
  seconds, on one row, and only by someone who also holds the environment key. That is the
  price of a reuse rule that does not fire on the user's own browser, and it is stated here
  rather than left to be discovered.
- The window is a configured constant, not a literal buried in the rotation code. Ten
  seconds is long enough for a serverless cold start and far too short for anything at human
  scale.
- Revocation of a family is immediate for refresh. Access tokens still expire on their own,
  within five minutes (ADR-0001).

## Alternatives considered

**Issue a sibling token instead of replaying the successor** — the loser of the race gets
its own new token in the same family, nothing is revoked. Simpler, and it stores no
recoverable token anywhere. Rejected because it is quietly fatal: attacker and victim would
then hold two independent chains that never collide again, so reuse detection would never
fire for the theft it exists to catch. Simplicity that deletes the feature is not
simplicity.

**Derive each successor from its predecessor**, `HMAC(key, predecessor)`, so a replay can be
recomputed and nothing needs storing. Elegant, and it promotes the derivation key to the
weight of the signing key: anyone holding it plus one old token computes every future token
in that family without ever presenting anything. A second secret of that consequence is not
worth avoiding one encrypted column that lives for ten seconds.

**A grace period that simply ignores reuse for a few seconds**, letting both callers proceed
with different tokens. That is the sibling alternative with fewer words and the same hole.

**Long-lived refresh tokens with no rotation.** Removes the problem by removing the exhibit.
