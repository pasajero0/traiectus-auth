---
description: Review the current branch — read the diff yourself, then run the code-reviewer subagent against the project's mandatory architecture rules.
argument-hint: "[optional: base branch, defaults to main]"
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

## Changed files

!`git diff --stat ${1:-main}...HEAD`

## Full diff

!`git diff ${1:-main}...HEAD`

## Instructions

1. **Read the diff above yourself first.** This is a first-pass review, not a delegation — the
   code-reviewer subagent is verification, not your substitute. Note anything suspicious before
   step 2.
2. Invoke the **code-reviewer** subagent. In its prompt, explicitly reference the project's
   mandatory review baseline (its path-scoped rules under `.claude/rules/`, plus the conventions in
   CLAUDE.md and `docs/`).
3. Treat every **Critical** finding as a merge blocker. Report findings grouped by severity.
4. If the reviewer flags one anti-pattern site, grep the touched files for analogous occurrences
   before reporting done.
