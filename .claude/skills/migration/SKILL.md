---
description: Drive a multi-step migration or refactor against a plan file in `.claude/tmp/<task>-plan.md`. Loads the active plan into context, walks the next pending step under the plan's invariants, marks completed steps. Trigger when the user says "start migration", "continue migration", "next migration step", or similar.
disable-model-invocation: false
---

## Active plan(s)

<!-- Path resolution: `${CLAUDE_SKILL_DIR%/skills/*}/tmp` strips `/skills/<name>` from this skill's directory to get `<repo>/.claude/`, then appends `/tmp`. Requires this SKILL.md to live at `<repo>/.claude/skills/migration/SKILL.md` — moving the directory breaks the resolver. -->

!`d="${CLAUDE_SKILL_DIR%/skills/*}/tmp"; if ls "$d"/*-plan.md >/dev/null 2>&1; then for f in "$d"/*-plan.md; do printf '\n=== %s ===\n' "$f"; cat "$f"; done; else echo "(no active plan in $d — create one first)"; fi`

## How to drive a migration

1. **If no plan is loaded above** — draft one from the decisions in the current conversation.
   Capture every committed invariant (numbered `Dn` style: scope, format, deviation policy,
   completion gate), plus a top-level `## Open questions` section recording every unresolved
   question raised by the user; it stays open until that question is explicitly closed. Save to
   `.claude/tmp/<task>-plan.md`, show it to the user, and wait for explicit approval. Re-read the
   saved plan from disk before proposing the first step.

2. **If a plan is loaded above** — identify the next pending step from the checklist at the bottom
   of the plan. Re-read the affected source files (do NOT cite from memory). Open the diff preview
   with a compliance header that names which invariants are honoured — for example:
   `Plan check: D1, D4 — ok; D3 — n/a`. Each invariant touched must be either honoured or flagged
   as a **deviation** (`ОТКЛОНЕНИЕ ОТ ПЛАНА`) with rationale, awaiting explicit approval before the
   diff appears.

3. **After applying a step** — verify the actual diff against the approved preview (call this the
   D12 verify: run `git diff` or re-read the changed lines; a divergence in either direction must
   be surfaced and explicitly accepted before the step is marked done). Then mark its checklist
   entry as `[x]` in the plan file with a one-line note about what landed. Run any gate the plan
   specifies (e.g. a `grep` clean of old paths) before declaring the step done.

4. **When every step is checked off** — propose deleting the plan file, after confirming with the
   user that the migration is fully landed and verified.
