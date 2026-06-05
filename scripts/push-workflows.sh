#!/usr/bin/env bash
set -eu

# push-workflows.sh — Push CI/CD workflow files to GitHub
#
# NOTE: Workflow files are now committed directly to the repository
# at .github/workflows/ and are automatically picked up by GitHub
# Actions. This script is kept for reference only.
#
# If you need to push workflow files manually, run:
#   git add .github/workflows/ && git commit -m "ci: update workflows" && git push

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══ CI/CD Workflow Status ═══"
echo ""

if [ -f "$ROOT/.github/workflows/ci.yml" ] && [ -f "$ROOT/.github/workflows/cd.yml" ]; then
  echo "Workflow files exist at .github/workflows/:"
  echo "  - ci.yml"
  echo "  - cd.yml"
  echo ""
  echo "These files are committed directly to the repository."
  echo "GitHub Actions will automatically pick them up."
else
  echo "Workflow files not found. Expected:"
  echo "  - .github/workflows/ci.yml"
  echo "  - .github/workflows/cd.yml"
  exit 1
fi
