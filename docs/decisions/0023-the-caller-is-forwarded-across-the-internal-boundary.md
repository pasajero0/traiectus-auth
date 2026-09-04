# ADR-0023: The browser's address is forwarded across the internal boundary

**Status:** accepted
**Date:** 2026-09-04
**Supersedes:** [ADR-0021](0021-the-credentials-rate-limit-shares-one-bucket.md)

## Context

`sso-api` is reached only by `sso-web`, server to server. Every browser-driven request
therefore arrives from `sso-web`'s own address, which left rate limiting with nobody to
count: ADR-0021 settled for a single fixed key, making the cap on
`/v1/credentials/verify` the entire service's budget rather than one person's, and named
the consequence out loud — a flood aimed at one account throttles everybody's sign-in.

That was acceptable while the deployment was known only to us. Publishing a link in the
README changes it, and two more routes need limits that a shared bucket cannot express:
registration pays a full argon2id hash per attempt and is the only route that admits
whether an address exists (ADR-0022), and `POST /v1/token` does real database work per
request.

## Decision

**`sso-web` forwards the browser's address on the internal call, and `sso-api` counts by
it — but reads it only from a caller that has proved it holds the internal key.**

- `sso-web` takes the address from the headers its platform writes
  (`x-vercel-forwarded-for`, `x-real-ip`, or the first entry of `x-forwarded-for`) and
  sends it as `x-traiectus-client-ip`. A header the browser sets itself is never read.
- `sso-api`'s `callerAddress` returns that value when — and only when — the request also
  carries the correct internal key, and otherwise falls back to `request.ip`.
- `POST /v1/token` is keyed differently, by the `client_id` claimed in HTTP Basic. Its
  callers are product servers, so every request from one product arrives from the same few
  addresses; an address key would put all of that product's users in one bucket.

**The address is the secondary counter, not the primary one.** OWASP's Authentication
Cheat Sheet is explicit that the counter belongs on the account rather than the source
address, because an attacker with a hundred addresses walks through an address limit
untouched, and NIST SP 800-63B requires a verifier to limit failed attempts against a
single account (its ceiling is a hundred consecutive ones). So signing in carries both:

| Counter | Key | Cap | What it catches |
|---|---|---|---|
| Sign-in, primary | the account | 20 failures / 15 min | Guessing at one account from many addresses |
| Sign-in, secondary | the browser | 30 / min | One host working through many accounts |
| Registration | the browser | 30 / hour | No account exists yet to key on |
| Hashing, service-wide | nothing | 60 / min | Anyone who rotates addresses |

The account counter spends on **failures only**, read first without incrementing. A person
who keeps typing the right password is never counted, so the limit cannot be turned around
and used to lock someone out of their own account — the denial of service OWASP warns that
lockout invites. It is a window rather than a run of consecutive failures, which is
stricter than what NIST asks for, not looser.

The per-address caps are deliberately loose. Behind an office, a university or a mobile
carrier's NAT, a great many people share one address, and a demonstration whose whole
purpose is that strangers try it must not have them lock each other out.

The key check inside `callerAddress` is the whole of the decision's safety, and it exists
because of *when* keys are computed: `keyGenerator` runs on `onRequest`, before any
`preHandler`, so the router has not yet authenticated anyone. Without the check, a stranger
could send `x-traiectus-client-ip: <someone else's address>` and spend that person's quota
— denial of service handed out through the defence against it. The comparison is the same
constant-time one the guard uses, exported rather than rewritten, so the two cannot drift.

## Consequences

- The caps become per-person and can be sized as such, and one address flooding sign-in no
  longer locks everyone else out. ADR-0021's named consequence is closed.
- Reading the plugin's verdict is a trap worth naming: `isAllowed` is `false` on every
  call, including the first against an empty counter, so treating it as permission refuses
  everything. `isExceeded` is the flag — and it rises one call later on a read that does
  not spend than on a spend, so asking "is anything left" and asking "did this go over" are
  two different questions with two different fields. Both were established by running the
  plugin, not by reading its typings.
- Registration gets a limit at all — thirty an hour per browser — which is what stands
  between one address lookup and a list of them, given ADR-0022.
- `/v1/token`'s key is a claim, not a verified fact, and that is sound rather than sloppy: a
  caller without the right secret reaches only a lookup in configured clients and one
  constant-time comparison, never the database or a hash. A real client holds exactly one
  id and cannot climb out of its own bucket.
- The counters live in the process. `sso-api` runs as one instance, so this holds; a second
  instance would need a shared store, and the limits would silently become per-instance
  until it had one.
- Locally there is no proxy, so nothing is forwarded and everything falls back to the
  connection's address — which is also what makes the fallback path the one exercised by
  every test that does not set the header deliberately.

## Sources

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  — the counter belongs on the account; lockout must not become a denial of service.
- [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html)
- [NIST SP 800-63B §5.2.2](https://pages.nist.gov/800-63-3/sp800-63b.html) — a verifier
  limits consecutive failed attempts on one account to no more than 100.

## Alternatives considered

**Key sign-in by the address alone.** What this ADR first shipped, and wrong: it is the
axis an attacker escapes by using more addresses, which is precisely why OWASP puts the
primary counter on the account. Kept as the secondary net, where it does catch one host
working through many accounts.

**Trust `x-forwarded-for` at `sso-api` directly.** Rejected: `sso-api` is reachable on the
public internet, and the header would then be whatever the last caller wrote. The internal
key is what makes a forwarded address mean anything.

**Move the limit to `sso-web`, where the browser's address is already known.** Rejected:
`sso-web` is serverless, so an in-process counter would be per instance and effectively
absent. `sso-api` is the one long-running process in the system, which is where a count can
be kept at all.

**Run the limit at `preHandler` so the router has already authenticated the caller.** The
plugin supports it, and it would remove the need for the key check inside `callerAddress`.
Rejected because the ordering between the plugin's hook and the route's own `preHandler`
guard is unspecified — a limit that silently reads an unauthenticated request would look
identical in tests and be wrong in production. Checking the key where the key is used says
what it means.
