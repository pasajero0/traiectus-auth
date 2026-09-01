# Path-scoped rules

This directory holds **path-scoped rules** — narrow, machine-checkable conventions that activate
only when a matching file is touched (frontmatter `paths:` glob).

**Rules are NOT shipped or copied — they are generated per-repo.** `agent-stack` deliberately leaves
this directory empty at deploy time, because rules must reflect *this* codebase's real conventions,
not another project's.

To generate them: open `claude` in this repo and run the **pattern-scout** subagent against your
code and architecture docs. It drafts rules marked `[DRAFT]`; review them, keep what fits, delete
the rest.

Each rule file looks like:

```markdown
---
description: <one line — what this rule enforces and when it fires>
paths:
  - "<glob, e.g. src/**/*.ts>"
---

# <Rule name>

## Do
- <convention> — detect: `<grep regex>` — severity: critical/warning/suggestion

## Don't
- <banned pattern> — detect: `<grep regex>` — severity: ...

## Why
<the failure mode this rule prevents>
```
