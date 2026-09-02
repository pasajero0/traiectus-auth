# ADR-0014: A token says what kind of token it is

**Status:** accepted
**Date:** 2026-09-02

## Context

Three bearer strings exist or are about to: the SSO session identifier, the refresh token,
and the authorization code. All three are 32 bytes from `node:crypto` rendered as base64url,
which makes them identical in shape and indistinguishable anywhere they appear.

Nothing prevents one being presented where another is expected except that the procedure
which happens to be running looks in a different table. That is discipline, and discipline
is what fails on the twentieth endpoint rather than the first. A token found in a log or a
bug report is also unattributable: nobody can say which kind leaked, or which store to go
and revoke.

## Decision

**Every bearer string carries a type prefix**, minted as the prefix followed by base64url of
32 random bytes:

| Prefix | What |
|---|---|
| `trs_` | SSO session — the `traiectus_sso` cookie |
| `trr_` | refresh token |
| `trc_` | authorization code |

The prefix is checked before any database lookup, and the whole string — prefix included —
is what gets hashed and stored.

The set is fixed now, before any token exists outside a development machine.

## Consequences

- A token of the wrong kind is refused without a query. The separation is mechanical rather
  than procedural, which is the whole point.
- Logs, incident reports and support conversations can name the kind of secret involved
  without anyone holding the secret.
- Entropy is unchanged: the prefix is metadata beside the same 256 bits, not part of them.
- A prefix cannot be changed later without invalidating every live token of that kind, which
  is why the set is decided here rather than grown as each token type arrives.
- Nothing in the system may infer a token's kind from anything but its prefix — deriving a
  type from a length or a table it happened to be found in is the pattern this replaces.

## Alternatives considered

**A checksum in the token**, as GitHub appends a CRC32 so that a scanner can recognise a
leaked token in public code without asking GitHub. Rejected: our tokens never appear in
committed code, and the guard already refuses credentials in committed text. It is cost with
no reader.

**Keeping them shapeless and relying on separate stores.** Status quo, and cheapest. Rejected
because "the right function was called" is not a property anything enforces.
