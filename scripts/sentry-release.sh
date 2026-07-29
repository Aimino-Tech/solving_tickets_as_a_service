#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# sentry-release.sh — Create and finalize a Sentry release for STAS.
#
# Usage:
#   SENTRY_AUTH_TOKEN=xxx SENTRY_ORG=xxx SENTRY_PROJECT=xxx \
#     ./scripts/sentry-release.sh [create|finalize|deploy]
#
# Requires:
#   - sentry-cli installed (https://docs.sentry.io/product/cli/installation/)
#   - SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT env vars
# ---------------------------------------------------------------------------

SENTRY_ORG="${SENTRY_ORG:?SENTRY_ORG is required}"
SENTRY_PROJECT="${SENTRY_PROJECT:?SENTRY_PROJECT is required}"
COMMIT_SHA="${GIT_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}"
ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"
RELEASE="stas@${COMMIT_SHA:0:12}"

sentry_cli() {
    if command -v sentry-cli &>/dev/null; then
        sentry-cli "$@"
    elif command -v npx &>/dev/null && npx --yes @sentry/cli --help &>/dev/null; then
        npx --yes @sentry/cli "$@"
    else
        echo "ERROR: sentry-cli not found. Install via: brew install getsentry/tools/sentry-cli"
        exit 1
    fi
}

case "${1:-create}" in
    create)
        echo "Creating Sentry release: $RELEASE"
        sentry_cli releases new "$RELEASE" --org "$SENTRY_ORG" --project "$SENTRY_PROJECT"
        sentry_cli releases set-commits "$RELEASE" --auto --org "$SENTRY_ORG"
        echo "Release $RELEASE created with auto commits"
        ;;
    finalize)
        echo "Finalizing Sentry release: $RELEASE"
        sentry_cli releases finalize "$RELEASE" --org "$SENTRY_ORG"
        echo "Release $RELEASE finalized"
        ;;
    deploy)
        echo "Creating Sentry deploy for release: $RELEASE → $ENVIRONMENT"
        sentry_cli releases deploys "$RELEASE" new -e "$ENVIRONMENT" --org "$SENTRY_ORG"
        echo "Deploy recorded for $RELEASE → $ENVIRONMENT"
        ;;
    *)
        echo "Usage: $0 [create|finalize|deploy]"
        exit 1
        ;;
esac
