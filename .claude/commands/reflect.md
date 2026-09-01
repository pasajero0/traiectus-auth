---
description: Consolidate the auto-memory store — find duplicate or contradictory memories and propose a cleanup as a diff, without writing anything automatically.
allowed-tools: Bash(ls:*), Bash(cat:*)
---

## Memory store

!`ls -la "$HOME/.claude/projects/$(pwd | sed 's#/#-#g')/memory"`

## Instructions

Manual reflection pass over the auto-memory store. The goal is to keep signal high as memories
accumulate — NOT to auto-generate rules. The memory dir is derived from the cwd the same way the
Stop hook derives it: `$HOME/.claude/projects/<cwd-with-slashes-as-dashes>/memory`.

1. Read every file in that directory, including the index file (MEMORY.md).
2. Identify:
   - **Duplicates** — two memories asserting the same rule/fact.
   - **Contradictions** — memories that conflict (often because one went stale).
   - **Stale entries** — memories naming files/flags/functions that no longer exist (verify by
     grep/read before flagging).
   - **Index drift** — index lines pointing to missing files, or files with no index line.
3. Present findings as a **proposed diff** the user reviews — do NOT edit memory files in this
   command. Pre-existing memory is not automatically canon; the user decides what to consolidate.
4. If nothing needs changing, say so plainly.
