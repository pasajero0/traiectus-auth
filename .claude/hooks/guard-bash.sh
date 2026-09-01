#!/usr/bin/env bash
# PreToolUse(Bash) guard — enforces hard prohibitions.
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

if printf '%s' "$cmd" | grep -Eq '(^|[&|;]|&&)[[:space:]]*git[[:space:]]+push\b'; then
  echo "Blocked: 'git push' is manual-only — the team pushes by hand." >&2
  exit 2
fi

# Package-manager guard. This repo is pnpm-only.
if printf '%s' "$cmd" | grep -Eq '(^|[&|;]|&&)[[:space:]]*(npm|yarn|bun)[[:space:]]'; then
  echo "Blocked: this repo uses pnpm only." >&2
  exit 2
fi

exit 0
