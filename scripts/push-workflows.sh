#!/usr/bin/env bash
set -eu

# push-workflows.sh — Push CI/CD workflow files to GitHub
#
# Your GitHub token needs the 'workflow' scope to push workflow files.
# Update your token at: https://github.com/settings/tokens
# Then run this script.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══ Pushing CI/CD workflow files ═══"
echo ""
echo "This will add and push .github/workflows/ files."
echo "These files are ready but weren't pushed because your"
echo "GitHub token needs the 'workflow' scope."
echo ""
echo "Update your token at:"
echo "  https://github.com/settings/tokens"
echo ""
echo "Make sure 'workflow' is checked under repository permissions."
echo ""

read -rp "Push workflow files now? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Skipping. You can push later with:"
  echo "  git add .github/workflows/ && git commit -m 'ci: add workflows' && git push"
  exit 0
fi

cd "$ROOT"

git add .github/workflows/ci.yml .github/workflows/cd.yml 2>/dev/null
git commit -m "ci: add CI/CD workflows" 2>/dev/null || echo "Nothing to commit (already pushed?)"

if git push 2>&1; then
  echo "✅ Workflow files pushed successfully!"
else
  echo ""
  echo "❌ Push failed. Your token may still lack the 'workflow' scope."
  echo "   Update it at: https://github.com/settings/tokens"
  echo ""
  echo "   The files are committed locally. When your token is ready, run:"
  echo "     git push"
  exit 1
fi
