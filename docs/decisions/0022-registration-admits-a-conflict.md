# ADR-0022: Registration admits a conflict; signing in does not

**Status:** accepted
**Date:** 2026-09-04

## Context

`.claude/CLAUDE.md` lists "errors must not reveal whether an account exists" among the
properties this project treats as non-negotiable, and signing in holds it completely:
`login/page.tsx` prints one message for every failure, and `domain/credentials.ts` runs
argon2id against a phantom hash when the address is unknown, so a wrong password and an
address nobody registered cost the same time as well as saying the same thing.

Registration does not hold it. `POST /v1/users` answers `409 email_taken` — correctly, for
an internal API whose only caller already holds the shared secret — and until now the
comment on that route said the browser boundary would hide it: *"sso-web shows the same
page either way."* The registration page shipped on 04/09 does not. It says the address is
taken.

The obvious reading is that the page is wrong and should be made uniform. It is not, and
the reason is structural rather than a matter of copy. Registration signs the person in the
moment it succeeds, because one password typed once is the whole point of the project. So
the two outcomes cannot be made to look alike:

- a free address ends on the dashboard, with a session cookie;
- a taken address ends back on the form.

Changing the sentence changes nothing about that. Whoever wants to know whether an address
is registered reads the destination, not the wording — which makes uniform copy here a
decoration that costs a real user the one message that would have helped them.

What closes it is not wording but a different shape: registration that ends the same way in
both cases, on "if that address is free, we have sent you a code," with the truth delivered
to the inbox instead of the screen. That requires sending email — verification is
deliberately out of scope (`.claude/CLAUDE.md`), and the project has no domain of its own,
so a free sender would have to use a shared pool whose deliverability is exactly as
reliable as the demonstration it would be gating.

## Decision

**Registration tells the truth about a conflict, and this file is why.** The rule against
revealing whether an account exists governs the sign-in path, where it is enforced in both
message and timing. Registration is stated as its exception rather than pretended away.

`sso-api` keeps answering `409` — its reasoning was never in question. The comment on
`routes/users.ts` that promised uniformity at the browser boundary is corrected, since it
now describes behaviour that does not exist.

Bulk enumeration — the threat that actually matters once the deployment is public — is
answered by rate limiting the registration path, not by copy.

## Consequences

- Someone can check one address at a time for registration. That is admitted in the README
  rather than left for a reader to discover, since a security claim this project does not
  hold is worse than an absent one.
- The rate limit on registration stops being optional the moment the README publishes a
  link, because it is the only thing standing between one lookup and a list of them.
- A person who already has an account is told so, and can go and sign in. Uniform copy
  would have left them guessing at a form that refuses them for reasons it will not name.
- If email verification is ever built, this ADR is superseded rather than amended: the flow
  changes shape, and the exception disappears with it.

## Alternatives considered

**Show the same generic failure as any other error.** Nearly chosen — it reads as the
secure option, and it is what the old comment promised. Rejected because it does not close
the leak: a free address still ends signed in on the dashboard and a taken one still ends
on the form, so the fact remains readable from where the browser lands. It would have cost
a real user a useful message and bought a property the system still would not have.

**Stop signing people in on success, and always answer "check your inbox."** The correct
answer, and the only one that closes it. Deferred with email verification itself: no
domain, and a shared sending pool would put the demonstration's main path in the spam
folder. Named on the Roadmap.

**Delete the rule from `.claude/CLAUDE.md` instead of narrowing it.** Rejected: it is true
of signing in, which is where password guessing actually happens, and it is enforced there
down to the hash timing. A rule that holds in one place and is written as if it holds
everywhere is the problem; the fix is precision, not deletion.
