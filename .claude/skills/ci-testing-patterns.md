# CI / Testing Patterns

Validated knowledge from this project's test + CI setup. Replace with **your project's** runner and
CI provider as you learn them.

## Test runner

- Config: `<test config file>`; run focused with `<runner> <substring>`.
- Test the logic-heavy modules; mock external processes/IO, not internal modules.

## CI

A minimal pipeline on PR:
- install dependencies (frozen lockfile)
- typecheck
- test
- lint commit messages (if the repo enforces a commit convention)

## Gotchas

Keep a running list of tool issues that bit CI (version quirks, cache keys, runtime drift), one
line each, so the next debugging session starts from known causes.
