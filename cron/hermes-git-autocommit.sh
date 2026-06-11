#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Hermes Git Auto-Commit Cron — daily at 21:00
# ============================================================
# What it does:
#   1. cd to repo, git status
#   2. If changes exist: git add, commit, pull --rebase, push
# ============================================================

REPO_DIR="/home/agent/Documents/hermes-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/hermes-git-autocommit.log"
LOCK_FILE="/tmp/hermes-git-autocommit.lock"

# Buffer logs: writes to LOG_FILE only at the very end, so git has a clean tree.
BUFFER=""

_append_log() {
    BUFFER="${BUFFER}[$(date)] $*\n"
}

# --- Lock (prevent overlap) ---
if [ -f "$LOCK_FILE" ]; then
    echo "[$(date)] SKIP — previous run still active" >> "$LOG_FILE"
    exit 0
fi
trap 'rm -f "$LOCK_FILE"; echo -e "$BUFFER" >> "$LOG_FILE"' EXIT
touch "$LOCK_FILE"

cd "$REPO_DIR"
_append_log "CHECK — running git status..."

# Check for changes (including untracked files)
if git diff --quiet --exit-code 2>/dev/null && git diff --cached --quiet --exit-code 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
    _append_log "CLEAN — no changes detected"
    exit 0
fi

_append_log "CHANGES DETECTED — committing and pushing..."
_append_log "$(git status 2>&1)"

# Stage everything
git add -A 2>&1

# Commit with timestamp
COMMIT_MSG="auto: daily commit $(date '+%Y-%m-%d %H:%M:%S')"
if ! git commit -m "$COMMIT_MSG" 2>&1; then
    _append_log "COMMIT FAILED — nothing to commit?"
    exit 0
fi
_append_log "COMMIT OK"

# Fetch, rebase, push — no log writes to file after this point (buffered)
if git pull --rebase origin main 2>&1; then
    _append_log "PULL/REBASE OK"
else
    _append_log "PULL/REBASE FAILED — needs manual conflict resolution"
    exit 1
fi

if git push origin main 2>&1; then
    _append_log "PUSH OK — all done"
else
    _append_log "PUSH FAILED"
    exit 1
fi

_append_log "DONE"
