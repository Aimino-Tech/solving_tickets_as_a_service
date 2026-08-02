#!/usr/bin/env bash
#
# eval-build-test.sh — STAS launch-readiness build + test gate.
#
# Proves the STAS repo builds and its test suite is green against the live
# checkout:
#
#   1. npm ci --legacy-peer-deps (fresh, reproducible install)
#   2. npm run build → exit 0
#   3. npm test → exit 0 (vitest, baseline ~2100+ tests)
#
# Usage: scripts/eval-build-test.sh
#
# Environment (all optional):
#   STAS_DIR     STAS repo checkout (default the repo root of this script)
#   SKIP_CI      set to 1 to skip `npm ci` (use existing node_modules)
#
# Exit code: 0 if build and tests pass, 1 otherwise.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STAS_DIR="${STAS_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

PASS=0
FAIL=0

pass() { echo "  [PASS]  $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL]  $1"; FAIL=$((FAIL + 1)); }

echo "=== STAS eval: build + test ==="
echo "STAS=$STAS_DIR"
echo ""

cd "$STAS_DIR"

if [ "${SKIP_CI:-}" != "1" ]; then
  echo "--- npm ci --legacy-peer-deps ---"
  if npm ci --legacy-peer-deps >/tmp/stas-eval-ci.log 2>&1; then
    pass "npm ci --legacy-peer-deps"
  else
    fail "npm ci --legacy-peer-deps (see /tmp/stas-eval-ci.log)"
  fi
else
  echo "  (npm ci skipped — SKIP_CI=1)"
fi

echo ""
echo "--- npm run build ---"
if npm run build >/tmp/stas-eval-build.log 2>&1; then
  pass "npm run build (tsc)"
else
  fail "npm run build (see /tmp/stas-eval-build.log)"
fi

echo ""
echo "--- npm test ---"
if npm test >/tmp/stas-eval-test.log 2>&1; then
  TESTS=$(grep -oE "[0-9]+ passed" /tmp/stas-eval-test.log | tail -1 || true)
  pass "npm test (${TESTS:-all green})"
else
  fail "npm test (see /tmp/stas-eval-test.log)"
  tail -20 /tmp/stas-eval-test.log
fi

echo ""
echo "=== Results: $((PASS + FAIL)) checks, $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
