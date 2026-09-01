#!/usr/bin/env bash
# SessionStart — write start-marker for Stop hook + inject git context (only on fresh starts).
set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // "."')
src=$(echo "$input" | jq -r '.source // "startup"')

mkdir -p /tmp/claude-sessions
# Sweep stale markers (>24h) so /tmp doesn't grow forever
find /tmp/claude-sessions -maxdepth 1 -type f -name '*.start' -mtime +1 -delete 2>/dev/null || true

# Always write a fresh marker for this session — Stop hook compares memory mtimes against it
touch "/tmp/claude-sessions/$session_id.start"

# Heavy git context: only on a truly new context window
case "$src" in
  startup|clear)
    if git -C "$cwd" rev-parse 2>/dev/null >/dev/null; then
      branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
      last=$(git -C "$cwd" log -1 --pretty='%h %s' 2>/dev/null || echo none)
      changed=$(git -C "$cwd" status --short 2>/dev/null | head -20)
      echo "## Session context"
      echo
      echo "- Branch: \`$branch\`"
      echo "- Last commit: $last"
      if [ -n "$changed" ]; then
        echo "- Working tree (first 20 entries):"
        echo '```'
        echo "$changed"
        echo '```'
      else
        echo "- Working tree: clean"
      fi
      echo
    fi
    ;;
esac

# Active migration plan(s) — fire on every source. Cheap (3 lines); most valuable
# on `compact` where prior nuances were summarized away.
if ls "${CLAUDE_PROJECT_DIR:-$cwd}"/.claude/tmp/*-plan.md >/dev/null 2>&1; then
  echo "⚠️ Active migration plan(s):"
  ls "${CLAUDE_PROJECT_DIR:-$cwd}"/.claude/tmp/*-plan.md
  echo "Re-read before acting; use /migration to continue."
  echo
fi

# Pending /reflect notice — always (cheap), regardless of source
if [ -f /tmp/.claude-reflect-pending ]; then
  echo "💡 Memory was modified in the previous session — consider running \`/reflect\` to consolidate."
  echo
  rm -f /tmp/.claude-reflect-pending
fi

exit 0
