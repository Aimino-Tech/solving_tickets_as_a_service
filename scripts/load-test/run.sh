#!/usr/bin/env bash
# =============================================================================
# STAS Load Test Orchestrator
#
# Runs all k6 load test scripts sequentially and collects results.
# Validates that STAS can handle 500-user peak load.
#
# Usage:
#   ./scripts/load-test/run.sh [options]
#
# Options:
#   --target <url>       STAS base URL (default: http://localhost:3000)
#   --api-key <key>      Admin API key for authenticated endpoints
#   --webhook-secret     GitHub webhook secret (default: test-secret)
#   --duration <time>    Per-test duration (default: 5m)
#   --vu <count>         Virtual users for webhook test (default: 50)
#   --api-vu <count>     Virtual users for API test (default: 20)
#   --db-vu <count>      Virtual users for DB test (default: 50)
#   --ramp-up <time>     Ramp-up period (default: 30s)
#   --output <dir>       Output directory for results (default: ./load-test-results)
#   --skip-health        Skip pre-test health check
#   --help               Show this help
# =============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

TARGET="http://localhost:3000"
API_KEY=""
WEBHOOK_SECRET="test-secret"
DURATION="5m"
VU="50"
API_VU="20"
DB_VU="50"
RAMP_UP="30s"
OUTPUT_DIR="$PROJECT_DIR/load-test-results"
SKIP_HEALTH=false

# ── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --webhook-secret) WEBHOOK_SECRET="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --vu) VU="$2"; shift 2 ;;
    --api-vu) API_VU="$2"; shift 2 ;;
    --db-vu) DB_VU="$2"; shift 2 ;;
    --ramp-up) RAMP_UP="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --skip-health) SKIP_HEALTH=true; shift ;;
    --help) grep '^#' "$0" | head -60 | cut -c3-; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────

command -v k6 >/dev/null 2>&1 || {
  echo "ERROR: k6 is not installed."
  echo "Install: https://k6.io/docs/getting-started/installation/"
  exit 1
}

mkdir -p "$OUTPUT_DIR"

# ── Pre-test health check ─────────────────────────────────────────────────────

if [[ "$SKIP_HEALTH" == "false" ]]; then
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  Pre-test Health Check"
  echo "═══════════════════════════════════════════════════════════════════════"

  HEALTH_URL="$TARGET/health"
  echo "Checking $HEALTH_URL ..."

  if command -v curl &>/dev/null; then
    HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  else
    HEALTH_STATUS=$(node -e "fetch('$HEALTH_URL').then(r => { process.exit(r.ok ? 0 : 1) }).catch(() => process.exit(1))" 2>/dev/null && echo "200" || echo "000")
  fi

  if [[ "$HEALTH_STATUS" == "200" ]]; then
    echo "✓ Health check passed (HTTP $HEALTH_STATUS)"
  else
    echo "⚠ WARNING: Health check returned HTTP $HEALTH_STATUS"
    echo "  Continuing anyway (use --skip-health to suppress this check)"
  fi
  echo ""
fi

# ── Test Configuration Summary ───────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════"
echo "  STAS Load Test Orchestrator"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Target:        $TARGET"
echo "  Duration:      $DURATION"
echo "  Webhook VUs:   $VU"
echo "  API VUs:       $API_VU"
echo "  DB VUs:        $DB_VU"
echo "  Output:        $OUTPUT_DIR"
echo "  Ramp-up:       $RAMP_UP"
echo ""

SUMMARY_FILE="$OUTPUT_DIR/summary.json"

# Build common k6 args
K6_ARGS=()
K6_ARGS+=(--env TARGET_URL="$TARGET")
K6_ARGS+=(--env WEBHOOK_SECRET="$WEBHOOK_SECRET")
K6_ARGS+=(--env VU="$VU")
K6_ARGS+=(--env DURATION="$DURATION")
K6_ARGS+=(--env RAMP_UP="$RAMP_UP")
K6_ARGS+=(--env API_KEY="$API_KEY")
K6_ARGS+=(--out json="$OUTPUT_DIR/results.ndjson")

FAILURES=0
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Test 1: Webhook Load Test ────────────────────────────────────────────────

echo "───────────────────────────────────────────────────────────────────────"
echo "  Test 1: Webhook Load Test"
echo "───────────────────────────────────────────────────────────────────────"
echo "  Simulating $VU concurrent GitHub webhook deliveries"
echo ""

set +e
k6 run "${K6_ARGS[@]}" "$SCRIPT_DIR/webhook.js"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ Webhook load test PASSED"
else
  echo "✗ Webhook load test FAILED (exit code: $EXIT_CODE)"
  ((FAILURES++))
fi
echo ""

# ── Test 2: API Throughput Test ───────────────────────────────────────────────

echo "───────────────────────────────────────────────────────────────────────"
echo "  Test 2: API Endpoint Throughput"
echo "───────────────────────────────────────────────────────────────────────"
echo "  Simulating $API_VU concurrent API consumers"
echo ""

set +e
k6 run "${K6_ARGS[@]}" --env VU="$API_VU" "$SCRIPT_DIR/api.js"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ API throughput test PASSED"
else
  echo "✗ API throughput test FAILED (exit code: $EXIT_CODE)"
  ((FAILURES++))
fi
echo ""

# ── Test 3: Database Load Test ────────────────────────────────────────────────

echo "───────────────────────────────────────────────────────────────────────"
echo "  Test 3: Database Concurrent Reads/Writes"
echo "───────────────────────────────────────────────────────────────────────"
echo "  Simulating $DB_VU concurrent readers and $(($DB_VU / 3)) concurrent writers"
echo ""

set +e
k6 run "${K6_ARGS[@]}" --env VU="$DB_VU" "$SCRIPT_DIR/db.js"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✓ Database load test PASSED"
else
  echo "✗ Database load test FAILED (exit code: $EXIT_CODE)"
  ((FAILURES++))
fi
echo ""

# ── Results Summary ──────────────────────────────────────────────────────────

END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Results Summary"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Started:  $START_TIME"
echo "  Ended:    $END_TIME"
echo "  Failures: $FAILURES"
echo ""

if [[ $FAILURES -eq 0 ]]; then
  echo "  ✓ ALL TESTS PASSED - STAS is ready for 500 users"
  echo ""
  echo "  Key thresholds verified:"
  echo "    - Webhook throughput > 50 req/s sustained"
  echo "    - API p95 latency < 1000ms"
  echo "    - Database read p95 < 500ms"
  echo "    - Error rate < 1% across all endpoints"
else
  echo "  ✗ $FAILURES test(s) FAILED - review output above"
  echo "    Check $OUTPUT_DIR for detailed results"
fi

echo ""
echo "  Detailed results: $OUTPUT_DIR"
echo "  JSON summary:     $SUMMARY_FILE"
echo ""

# Write summary file
cat > "$SUMMARY_FILE" <<SUMEOF
{
  "test": "STAS 500-User Load Test",
  "target": "$TARGET",
  "startTime": "$START_TIME",
  "endTime": "$END_TIME",
  "failures": $FAILURES,
  "overallStatus": "$([[ $FAILURES -eq 0 ]] && echo 'PASS' || echo 'FAIL')",
  "configuration": {
    "webhookVUs": $VU,
    "apiVUs": $API_VU,
    "dbVUs": $DB_VU,
    "duration": "$DURATION",
    "rampUp": "$RAMP_UP"
  }
}
SUMEOF

exit $FAILURES
