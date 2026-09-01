# Team Conventions

Fill each section with **this project's** actual rules. The structure below is the transferable
part; the values are placeholders the deploying agent (or you) should replace.

## Commits

Format: `type(scope): message` (Conventional Commits if the repo runs commitlint).

**Types**: feat, fix, chore, refactor, test, docs, style, perf, ci, build, revert
**Scopes**: enumerate the areas the project uses as scopes.
**Issue reference**: how this repo links work (e.g. `Closes #NN`).

## Branches

Main branch: `main`. `git push` is manual-only (the guard-bash hook blocks the agent).

## Git hooks

- `pre-commit`: <linter/typecheck on staged files, or empty>.
- `commit-msg`: <commit-message linting, if any>.

## Code style

Capture the load-bearing rules: typing strictness, import conventions, formatter settings, naming.

## Hard prohibitions

- **pnpm only** — other package managers are blocked by the guard-bash hook.
- **Never `git push`** from the agent — manual-only.
- **Never hand-edit generated files** (*/dist/*|dist/*|*/build/*, pnpm-lock.yaml).
