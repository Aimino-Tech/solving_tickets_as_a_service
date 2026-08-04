#!/bin/bash
# Creates a syntaro-demo repository with pre-configured issues labeled syntaro:fix
#
# NOTE: The primary syntaro-demo repo is already live at:
#   https://github.com/Aimino-Tech/syntaro-demo
#
# This script is preserved for creating additional demo instances
# (e.g. for staging, testing, or workshop environments).
set -euo pipefail

DEMO_REPO="${1:-syntaro-demo}"
GITHUB_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"

# Create repo
gh repo create "$DEMO_REPO" --public --description "Demo repo for SYNTARO" --confirm

# Seed the repo from the canonical demo app
echo "Cloning canonical demo repo..."
TMP_DIR=$(mktemp -d)
git clone https://github.com/Aimino-Tech/syntaro-demo.git "$TMP_DIR"
cd "$TMP_DIR"
git remote set-url origin "https://github.com/Aimino-Tech/$DEMO_REPO.git"
git push -u origin main

# Create issues with syntaro:fix label
gh label create syntaro:fix --repo "$DEMO_REPO" --color "8250DF" --description "SYNTARO will automatically fix this issue" 2>/dev/null || true

gh issue create --repo "$DEMO_REPO" --title "Fix typo in README" --body "The README has a typo in the installation section.\n\nLine 15: 'instalation' should be 'installation'\n\nCan someone fix this?" --label syntaro:fix

gh issue create --repo "$DEMO_REPO" --title "Add input validation for email field" --body "The signup form at src/auth/signup.ts doesn't validate email format before submission.\n\n**Steps to reproduce:**\n1. Go to /signup\n2. Enter invalid email 'not-an-email'\n3. Click submit\n\n**Expected:** Client-side validation error shown\n**Actual:** Form submits to API which returns 400" --label syntaro:fix

gh issue create --repo "$DEMO_REPO" --title "Fix cross-file import path in utils" --body "src/utils/helpers.ts imports from '../../core/parser' but the correct path is '../core/parser'.\n\nThis breaks the build on case-sensitive filesystems." --label syntaro:fix

gh issue create --repo "$DEMO_REPO" --title "Handle empty response in API client" --body "src/api/client.ts doesn't handle empty responses gracefully.\n\nWhen the API returns 204 No Content, JSON.parse() throws because the body is empty.\n\nAdd a check to return null instead of parsing empty body." --label syntaro:fix

echo "✅ Demo repo created: $DEMO_REPO"
echo "   Issues created with syntaro:fix label"
