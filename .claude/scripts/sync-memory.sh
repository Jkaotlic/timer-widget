#!/usr/bin/env bash
# Auto-sync Claude Code memory directories to their GitHub repos.
# Triggered by the Stop hook in .claude/settings.json after each Claude turn.
# Silent on success, never blocks Claude (best-effort). Runs on any machine:
# scans every memory/.git under ~/.claude/projects/ and syncs each independently.

set +e

shopt -s nullglob

for mem in "$HOME"/.claude/projects/*/memory; do
    [ -d "$mem/.git" ] || continue

    (
        cd "$mem" || exit 0

        git add -A >/dev/null 2>&1 || exit 0

        if git diff --cached --quiet; then
            exit 0
        fi

        git commit -m "auto: memory snapshot $(date +%Y-%m-%dT%H:%M)" >/dev/null 2>&1 || exit 0
        git push >/dev/null 2>&1 || exit 0
    )
done

exit 0
