#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit) — D12 post-apply verify.
# Active ONLY when at least one migration plan exists in .claude/tmp/.
# Outside active migrations: zero noise, near-zero latency.
#
# Caveat: diff is git working-tree vs HEAD, so it shows ALL uncommitted
# changes to the file, not only the change from the just-completed tool call.
# That caveat is surfaced in the additionalContext so Claude does not
# over-interpret unrelated edits.
#
# `set -e` and `pipefail` deliberately omitted: `git diff | head -200`
# triggers SIGPIPE on diffs >200 lines, which would crash the hook under
# pipefail. Defensive philosophy: always exit 0.
#
# JSON build: python3 (stdin + UTF-8 "replace" decode) preferred — survives
# non-UTF-8 bytes from arbitrary diff content. Fallback: `jq --rawfile` via
# temp file if python3 is absent.
#
# Historical note: do NOT use `echo "$out" | jq .` to post-process — the hook
# runner may exec `zsh -c`, and zsh's `echo` interprets `\n` escapes, turning
# valid escaped JSON back into raw LF before parsing. Use `printf '%s'`.
set -u

# (1) Early-exit if no active migration plan.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLAN_DIR="$PROJECT_DIR/.claude/tmp"
ls "$PLAN_DIR"/*-plan.md >/dev/null 2>&1 || exit 0

# (2) Parse file path from tool_input.
input=$(cat)
path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$path" ] && exit 0

# (3) Normalize to absolute path so case-glob matches reliably for relative paths.
case "$path" in
  /*) abs_path="$path" ;;
  *)  abs_path="$PROJECT_DIR/$path" ;;
esac

# (4) Skip noise paths (same filter spirit as post-edit-lint.sh).
case "$abs_path" in
  *.gen.*|*/node_modules/*|*/dist/*|*/build/*|*/storybook-static/*|*/coverage/*) exit 0 ;;
esac

# (5) Build diff: tracked → git diff -U2 (truncated 200 lines); untracked → head -50.
cd "$PROJECT_DIR" 2>/dev/null || exit 0
if git ls-files --error-unmatch -- "$abs_path" >/dev/null 2>&1; then
  diff_output=$(timeout 10 git diff -U2 -- "$abs_path" 2>/dev/null | head -200)
else
  diff_output=$(head -50 "$abs_path" 2>/dev/null)
fi
[ -z "$diff_output" ] && exit 0

# (6) Build ctx then emit JSON.
ctx="POST-APPLY VERIFY (D12) $abs_path:
$diff_output

(diff may include earlier uncommitted changes to this file)

Compare against the approved preview table. Report any mismatch before marking the step done."

if command -v python3 >/dev/null 2>&1; then
  printf '%s' "$ctx" | python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":sys.stdin.buffer.read().decode("utf-8","replace")}}))'
else
  tmpf=$(mktemp)
  printf '%s' "$ctx" > "$tmpf"
  jq -nc --rawfile ctx "$tmpf" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$ctx}}'
  rm -f "$tmpf"
fi

exit 0
