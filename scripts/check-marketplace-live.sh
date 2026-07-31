#!/usr/bin/env bash
# =============================================================================
# scripts/check-marketplace-live.sh — Marketplace Readiness Check (AIM-4363)
#
# Verifies the two URLs GitHub Marketplace requires on a listing:
#   - https://stas.aimino.io/privacy  (must return 200 + content)
#   - https://stas.aimino.io/terms    (must return 200 + content)
#
# Also checks that the hostname resolves at all, so a DNS misconfiguration
# is reported distinctly from a serving failure.
#
# Usage:
#   bash scripts/check-marketplace-live.sh                 # default: stas.aimino.io
#   bash scripts/check-marketplace-live.sh --base https://example.com
#   bash scripts/check-marketplace-live.sh --help
#
# Environment variables:
#   MARKETPLACE_BASE_URL   Default: https://stas.aimino.io
#
# Exit codes:
#   0 — All checks passed (DNS resolves, /privacy and /terms return 200)
#   1 — One or more checks failed
#   2 — A required dependency (dig/curl) is missing
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
BASE_URL="${MARKETPLACE_BASE_URL:-https://stas.aimino.io}"
HOST="$(printf '%s' "$BASE_URL" | sed -E 's|^[a-z]+://||; s|/.*$||')"
PATHS=("/privacy" "/terms")

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Marketplace Readiness Check (AIM-4363)

Verifies that the privacy policy and terms of service URLs required by a
GitHub Marketplace listing resolve and serve HTTP 200 with content.

Usage:
  bash scripts/check-marketplace-live.sh
  bash scripts/check-marketplace-live.sh --base https://stas.aimino.io
  bash scripts/check-marketplace-live.sh --help

Environment:
  MARKETPLACE_BASE_URL   Default: https://stas.aimino.io

Exit codes:
  0 — All checks passed
  1 — One or more checks failed
  2 — A required dependency is missing
EOF
}

# ── Prerequisites ───────────────────────────────────────────────────────────
for dep in dig curl; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Missing required dependency: $dep" >&2
    exit 2
  fi
done

# ── Checks ──────────────────────────────────────────────────────────────────
TOTAL=0
PASSED=0
FAILED=0

check() {
  local desc="$1"
  local status="$2" # "PASS" or "FAIL"
  TOTAL=$((TOTAL + 1))
  if [ "$status" = "PASS" ]; then
    PASSED=$((PASSED + 1))
    echo -e "${GREEN}✓${NC} $desc"
  else
    FAILED=$((FAILED + 1))
    echo -e "${RED}✗${NC} $desc"
  fi
}

echo "== DNS =="
if dig +short "$HOST" | grep -q .; then
  check "DNS resolves: $HOST -> $(dig +short "$HOST" | head -1)" "PASS"
else
  check "DNS resolves: $HOST (NXDOMAIN — add the CNAME in docs/marketplace/submission-runbook.md Phase A1)" "FAIL"
fi

for path in "${PATHS[@]}"; do
  url="${BASE_URL}${path}"
  echo "== ${path} =="
  code="$(curl -s -o /tmp/marketplace-check-body.$$ -w '%{http_code}' --max-time 15 "$url" || true)"
  size=0
  if [ -f /tmp/marketplace-check-body.$$ ]; then
    size="$(wc -c < /tmp/marketplace-check-body.$$ | tr -d ' ')"
  fi
  if [ "$code" = "200" ] && [ "$size" -gt 0 ]; then
    check "$url -> HTTP $code ($size bytes)" "PASS"
  else
    check "$url -> HTTP ${code:-timeout} (expected 200 with content)" "FAIL"
  fi
  rm -f /tmp/marketplace-check-body.$$
done

echo ""
echo "Result: $PASSED/$TOTAL checks passed"
if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}Not marketplace-ready.${NC} See docs/marketplace/submission-runbook.md (Phase A) to unblock."
  exit 1
fi
echo -e "${GREEN}Marketplace-ready.${NC} Both required URLs are live."
exit 0
