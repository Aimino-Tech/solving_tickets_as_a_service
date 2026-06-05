#!/usr/bin/env bash
set -eu

# push-workflows.sh — No longer needed
#
# CI/CD workflow files are now committed directly to the repository at
# .github/workflows/ci.yml and .github/workflows/cd.yml.
# GitHub Actions picks them up automatically on push.
#
# This script is kept for reference but does nothing.
# To remove: delete this file and update .gitignore if needed.

echo "CI/CD workflows are committed directly in .github/workflows/"
echo "No push action required — GitHub Actions will pick them up automatically."
