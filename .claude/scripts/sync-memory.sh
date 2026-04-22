#!/usr/bin/env bash
# Auto-sync Claude Code memory directory to its dedicated GitHub repo.
# Triggered by the Stop hook in .claude/settings.json after each Claude turn.
# Silent on success, never blocks Claude (best-effort).

set -e

MEM="$HOME/.claude/projects/f--VScode-timer-widget/memory"

# Bail out if memory folder isn't a git repo on this machine
[ -d "$MEM/.git" ] || exit 0

cd "$MEM"

# Stage everything; if no changes, exit cleanly
git add -A
if git diff --cached --quiet; then
    exit 0
fi

# Commit + push silently; tolerate network/auth failures
git commit -m "auto: memory snapshot $(date +%Y-%m-%dT%H:%M)" >/dev/null 2>&1 || exit 0
git push >/dev/null 2>&1 || exit 0
