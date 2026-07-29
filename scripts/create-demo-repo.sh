#!/bin/bash
# Creates a stas-demo repository with pre-configured issues labeled stas:fix
set -euo pipefail

DEMO_REPO="${1:-stas-demo}"
GITHUB_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN required}"

# Create repo
gh repo create "$DEMO_REPO" --public --description "Demo repo for STAS - Solving Tickets As A Service" --confirm

# Create issues with stas:fix label
gh label create stas:fix --repo "$DEMO_REPO" --color "8250DF" --description "STAS will automatically fix this issue" 2>/dev/null || true

gh issue create --repo "$DEMO_REPO" --title "Fix typo in README" --body "The README has a typo in the installation section.\n\nLine 15: 'instalation' should be 'installation'\n\nCan someone fix this?" --label stas:fix

gh issue create --repo "$DEMO_REPO" --title "Add input validation for email field" --body "The signup form at src/auth/signup.ts doesn't validate email format before submission.\n\n**Steps to reproduce:**\n1. Go to /signup\n2. Enter invalid email 'not-an-email'\n3. Click submit\n\n**Expected:** Client-side validation error shown\n**Actual:** Form submits to API which returns 400" --label stas:fix

gh issue create --repo "$DEMO_REPO" --title "Fix cross-file import path in utils" --body "src/utils/helpers.ts imports from '../../core/parser' but the correct path is '../core/parser'.\n\nThis breaks the build on case-sensitive filesystems." --label stas:fix

gh issue create --repo "$DEMO_REPO" --title "Handle empty response in API client" --body "src/api/client.ts doesn't handle empty responses gracefully.\n\nWhen the API returns 204 No Content, JSON.parse() throws because the body is empty.\n\nAdd a check to return null instead of parsing empty body." --label stas:fix

echo "✅ Demo repo created: $DEMO_REPO"
echo "   Issues created with stas:fix label"
