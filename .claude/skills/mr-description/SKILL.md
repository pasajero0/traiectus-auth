---
description: Draft a GitHub pull request description for the current branch following a compact template (what / scenarios / verification). Use when the user asks to write, draft, or generate a PR description for the current branch.
allowed-tools: Bash(git rev-parse:*), Bash(git log:*), Bash(git diff:*)
---

## Current branch state

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Commits ahead of main (origin first, local fallback):

!`git log origin/main..HEAD --oneline 2>/dev/null | head -30 || git log main..HEAD --oneline 2>/dev/null | head -30 || echo "(no upstream or local main branch found)"`

- Files changed (top 20):

!`git diff origin/main...HEAD --stat --stat-count=20 2>/dev/null || git diff main...HEAD --stat --stat-count=20 2>/dev/null || echo "(diff unavailable)"`

## Style rules

- "What" block ≤ 2 sentences. State user-visible behaviour / CLI surface change; no implementation
  detail. If you need more than 2 sentences, the scope is too wide — split.
- "Scenarios" use imperative + arrow notation: `<command> → <expected>`. Not full sentences.
- For a CLI, scenarios are commands the reviewer runs (e.g. `agent-stack detect → lists Claude
  Code`); state which directory / fixture to run them in if it matters.
- Link the GitHub issue narratively or with `Closes #NN` — this repo has no Jira.

## Delivery format

Wrap the entire PR body in a **single fenced code block** (use four backticks if the body itself
contains code fences). The user copies the block once; GitHub renders markdown on paste. Do NOT
render markdown inline in the reply — bold/lists/headers won't survive the clipboard hop.

## Template

````markdown
**What this PR does / why we need it:**

<One- or two-sentence summary of the user-visible / CLI behaviour change.>

**Scenarios**

1. **<Scenario name>** — `<command>` → <expected outcome>.
2. **<Scenario name>** — `<command>` → <expected outcome>.

**Verification**

- `pnpm typecheck && pnpm test` — green.

Closes #<issue>
````

## When to deviate

- **Bug-fix PR:** add a "**Reproduction**" line above "Scenarios" with exact repro steps, then
  scenarios verify the fix.
- **Pure refactor / chore:** drop "Scenarios"; replace with "No behaviour change — verified by
  `pnpm test`".
