#!/usr/bin/env bash
set -euo pipefail

TICKET_ID="${1:?Usage: $0 <TICKET-ID> <BRANCH-NAME> <TICKET-DESCRIPTION>}"
BRANCH_NAME="${2:?Usage: $0 <TICKET-ID> <BRANCH-NAME> <TICKET-DESCRIPTION>}"
TICKET_DESC="${3:?Usage: $0 <TICKET-ID> <BRANCH-NAME> <TICKET-DESCRIPTION>}"

WORKTREE_ROOT="/tmp/opencode/worktrees/$TICKET_ID"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "=== ralph-loop: $TICKET_ID ==="
echo "Branch: $BRANCH_NAME"
echo "Worktree: $WORKTREE_ROOT"

if [ -d "$WORKTREE_ROOT" ]; then
  echo "Removing existing worktree..."
  rm -rf "$WORKTREE_ROOT"
  git worktree prune
fi

echo "Creating worktree..."
mkdir -p "$(dirname "$WORKTREE_ROOT")"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_ROOT" master

cp "$REPO_ROOT/opencode.json" "$WORKTREE_ROOT/" 2>/dev/null || true
cp -r "$REPO_ROOT/.opencode" "$WORKTREE_ROOT/" 2>/dev/null || true

echo "Worktree ready at $WORKTREE_ROOT"
echo "=== Ready to implement $TICKET_ID ==="
