#!/usr/bin/env bash
# SessionEnd hook: append one line per Claude Code session to ai-usage/<seat>.md.
# Satisfies hard rule 6 (AI-USAGE.md appended every session) without depending on
# anyone remembering at 3am. Per-seat files so four people never merge-conflict.
# Never fails the session: every step degrades to a placeholder.
set -uo pipefail

payload="$(cat)"

root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
cd "$root" || exit 0

session="$(printf '%s' "$payload" | node -e '
let d = "";
process.stdin.on("data", c => d += c).on("end", () => {
  let id = "unknown";
  try { id = JSON.parse(d).session_id || "unknown"; } catch {}
  process.stdout.write(String(id));
});' 2>/dev/null)"
[ -z "$session" ] && session="unknown"

seat="${HANDOFF_SEAT:-}"
[ -z "$seat" ] && seat="$(git config user.name 2>/dev/null || true)"
[ -z "$seat" ] && seat="${USER:-unknown}"

slug="$(printf '%s' "$seat" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')"
[ -z "$slug" ] && slug="unknown"

files="$(git status --porcelain 2>/dev/null | awk '{print $NF}' | grep -v '^ai-usage/' | head -12 | paste -sd, - | sed 's/,/, /g' || true)"
[ -z "$files" ] && files="no working-tree changes"

mkdir -p ai-usage || exit 0
log="ai-usage/${slug}.md"
if [ ! -f "$log" ]; then
  printf '# AI usage log — %s\n\nOne entry per Claude Code session, appended automatically at session end.\nWritten-up disclosure lives in the root AI-USAGE.md.\n' "$seat" > "$log"
fi

printf '\n- %s — session `%s` — touched: %s\n' \
  "$(date +'%Y-%m-%d %H:%M %Z')" "$session" "$files" >> "$log"

exit 0
