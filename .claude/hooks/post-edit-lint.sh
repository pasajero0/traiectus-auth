#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit) — lint edited source files, surface issues as additionalContext.
# Does NOT modify the file (no --fix) — keeps Claude's file-state tracking consistent.
# NOTE: this repo currently has no linter installed, so this hook self-disables
# (the `[ -x "$LINTER" ] || exit 0` guard). Install a linter or point LINTER at it to enable.
set -euo pipefail

input=$(cat)
path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$path" ] && exit 0

case "$path" in
  *.ts|*.tsx|*.js|*.jsx|*.mts|*.cts) ;;
  *) exit 0 ;;
esac

case "$path" in
  *.gen.*|*/node_modules/*|*/dist/*|*/build/*|*/storybook-static/*|*/coverage/*) exit 0 ;;
esac

LINTER="${CLAUDE_PROJECT_DIR:-$(pwd)}/node_modules/.bin/eslint"
[ -x "$LINTER" ] || LINTER="$(command -v eslint || true)"
[ -x "$LINTER" ] || exit 0

CACHE_DIR=/tmp/claude-eslint-cache
mkdir -p "$CACHE_DIR"

output=$(timeout 20 "$LINTER" \
  --cache \
  --cache-location "$CACHE_DIR/" \
  --cache-strategy content \
  --format=json \
  --no-warn-ignored \
  "$path" 2>/dev/null) || true

# Parse only if output is valid JSON (eslint may bail on config errors)
echo "$output" | jq empty 2>/dev/null || exit 0

filtered=$(echo "$output" | jq -r '
  .[].messages[]?
  | select(.severity >= 1)
  | "  \(if .severity==2 then "✘" else "⚠" end) line \(.line):\(.column)  \(.message)  (\(.ruleId // "—"))"
' 2>/dev/null)

if [ -n "$filtered" ]; then
  jq -nc --arg ctx "Linter issues in $(basename "$path"):
$filtered" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi

exit 0
