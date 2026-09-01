#!/usr/bin/env bash
# Stop — fires every assistant turn. Keep work tiny.
# If any memory file changed since session start, raise the /reflect-pending flag.
set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
marker="/tmp/claude-sessions/$session_id.start"
[ -f "$marker" ] || exit 0

# Self-derive the auto-memory dir slug from the session cwd (every "/" → "-").
cwd=$(echo "$input" | jq -r '.cwd // empty')
[ -z "$cwd" ] && exit 0
slug="${cwd//\//-}"
MEM="$HOME/.claude/projects/${slug}/memory"
[ -d "$MEM" ] || exit 0

# -quit stops at first match → ~few ms even if memory has many files
if find "$MEM" -maxdepth 1 -name '*.md' -newer "$marker" -print -quit 2>/dev/null | grep -q .; then
  touch /tmp/.claude-reflect-pending
fi

# Do NOT remove the marker — Stop fires on every turn within the same session.
exit 0
