# ADR-0012: Documentation lives next to the code, and splits by threshold

**Status:** accepted
**Date:** 2026-09-02

## Context

Three layers of documentation already exist and divide the work without overlapping:
[ADRs](.) say why something was decided, [CODEMAP.md](../../CODEMAP.md) says where things
live, and a service's own `README.md` beside its handlers says what it answers right now —
`apps/sso-api/src/routes/README.md` is the first of those and already carries the route
table and the response codes.

A fourth was proposed: a `docs/` directory inside every application, one document per
feature, describing the feature as it currently stands. The intent is right and is the
reason this record exists rather than a refusal — documentation that is written beside the
code and edited with it is the only kind that stays true.

What narrows the choice is not taste:

- Documentation drifts unless it is edited in the same commit as the behaviour it
  describes. The number of places that must be edited is therefore the running cost, paid
  by one person, every commit, forever.
- The repository is read as an artifact about security. A reader who catches one statement
  that is no longer true stops believing the rest, so short and exact beats broad and
  approximately right.
- Six applications, and before the ship date five of them have almost nothing to say:
  `beacon-api` is deliberately thin, `harbor-api` is one resource server, and the three
  `-web` applications are placeholder pages. A directory created ahead of its content is
  an empty directory on a public repository.
- A fourth layer earns its place only by taking content away from one of the three. One
  that adds a second telling of the same thing has created a copy, and copies diverge.

## Decision

**Each application has exactly one state document, next to the code it describes** —
`src/routes/README.md` for an API, `src/app/README.md` for a web application once it has
pages. It says what exists now, never what is planned, and it is edited in the commit that
changes the behaviour.

**It splits into `apps/<app>/docs/`, one file per surface, when it covers more than three
independent surfaces or stops being readable in one sitting** — whichever comes first. The
split happens along the seam that has actually appeared, not one guessed in advance, and
the single README stays as the index that points into the directory.

## Consequences

- Four layers, each answering one question: why (ADR), where (CODEMAP), what it answers now
  (the app's state document), and how to run it (the root README).
- `apps/sso-api` is the only application expected to reach the threshold, once sessions,
  authorization codes, token issuance and rotation are all in place — after 04/09. The
  other five keep one file, most of them through to the ship date.
- The trigger is the file itself rather than a date, so the expansion cannot be scheduled,
  argued about, or done early.
- Nothing enforces this mechanically. `scripts/check-boundaries.mjs` reads imports, not
  prose; a state document that has gone stale is a review finding like any other defect.
- Planned behaviour has no home in these documents and stays where it already lives — the
  Roadmap in the root README for product scope, the dated schedule in the working plan for
  everything else.

## Alternatives considered

**A `docs/` directory per application from the start.** The proposal as first made, and the
nearly-chosen option: it needs no threshold and no judgement about when to split. Rejected
because five of six applications would hold an empty or near-empty directory until the ship
date, and because the split points are not yet known — a directory structure invented before
the code that fills it encodes a guess about where the seams are, which then has to be
maintained against the seams that turn out to exist.

**One `docs/` tree at the repository root covering every service.** Rejected because
distance from the code is precisely what makes documentation drift: a file three directories
away from the handler it describes is not opened by the commit that changes the handler.
The cross-service view that would justify it is already CODEMAP's job.

**No per-application documentation at all — ADRs and CODEMAP only.** Cheapest, and it was
the status quo until the route table was written. Rejected because neither layer answers
"what does this service accept and return today", which is the question `sso-web` is written
against and the one a reviewer asks first.
