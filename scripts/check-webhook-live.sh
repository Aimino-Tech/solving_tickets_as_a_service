#!/usr/bin/env bash
# =============================================================================
# scripts/check-webhook-live.sh — Webhook Endpoint Readiness Check
#
# Verifies the GitHub App webhook endpoint for SYNTARO:
#   - GET  https://api.syntaro.io/health   (must return HTTP 200)
#   - POST https://api.syntaro.io/webhook  (must NOT return 502 — 4xx is fine,
#                                          proves the origin is reachable)
#
# This is the acceptance gate for the Cloudflare Tunnel handoff
# (docs/ops/cloudflare-tunnel-handoff.md). Run it after the tunnel is live.
#
# Usage:
#   bash scripts/check-webhook-live.sh                  # default: https://api.syntaro.io
#   bash scripts/check-webhook-live.sh --base http://localhost:3001
#   bash scripts/check-webhook-live.sh --help
#
# Environment variables:
#   WEBHOOK_BASE_URL   Default: https://api.syntaro.io
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more checks failed
#   2 — A required dependency (curl) is missing
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
BASE_URL="${WEBHOOK_BASE_URL:-https://api.syntaro.io}"
HEALTH_PATH="/health"
WEBHOOK_PATH="/webhook"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Help ────────────────────────────────────────────────────────────────────
show_help() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

if [[ "${1:-}" == "--base" ]]; then
  BASE_URL="${2:?usage: --base <url>}"
fi

# ── Dependency check ────────────────────────────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  echo -e "${RED}✗ curl is required but not installed${NC}" >&2
  exit 2
fi

# ── Checks ──────────────────────────────────────────────────────────────────
failures=0

check() {
  local name="$1" url="$2" method="$3" expect_ok="$4"
  local code
  if [[ "$method" == "POST" ]]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$url" || true)"
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
  fi

  if [[ "$expect_ok" == "200" && "$code" == "200" ]] || [[ "$expect_ok" == "not502" && "$code" != "502" && "$code" != "000" ]]; then
    echo -e "  ${GREEN}✓${NC} $name → HTTP $code"
  else
    echo -e "  ${RED}✗${NC} $name → HTTP $code (expected ${expect_ok})"
    failures=$((failures + 1))
  fi
}

echo "Webhook readiness check for $BASE_URL"
echo ""

echo "Health endpoint:"
check "GET ${BASE_URL}${HEALTH_PATH}" "${BASE_URL}${HEALTH_PATH}" "GET" "200"

echo ""
echo "Webhook endpoint (reachability — 4xx/2xx OK, 502 = origin still down):"
check "POST ${BASE_URL}${WEBHOOK_PATH}" "${BASE_URL}${WEBHOOK_PATH}" "POST" "not502"

echo ""
if [[ "$failures" -eq 0 ]]; then
  echo -e "${GREEN}All checks passed — the webhook endpoint is live.${NC}"
  echo "Next: check GitHub App → syntaro-bot → Advanced → Recent Deliveries for HTTP 200."
  exit 0
else
  echo -e "${RED}${failures} check(s) failed — the Cloudflare Tunnel handoff is not complete.${NC}"
  echo "See docs/ops/cloudflare-tunnel-handoff.md for the tunnel steps."
  exit 1
fi
