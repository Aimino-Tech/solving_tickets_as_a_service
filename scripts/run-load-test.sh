#!/bin/bash
set -euo pipefail

SYNTARO_URL="${1:-http://localhost:3000}"
REPORT_DIR="load-tests/reports/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"

run() {
  local n="$1"; local s="$2"
  echo "--- $n ---"
  SYNTARO_URL="$SYNTARO_URL" k6 run --out json="$REPORT_DIR/$n.json" --summary-export="$REPORT_DIR/$n-summary.json" "$s"
}

run "api-benchmark" "load-tests/scenarios/api-benchmark.js"
run "webhook-flood" "load-tests/scenarios/webhook-flood.js"
run "queue-throughput" "load-tests/scenarios/queue-throughput.js"

echo "=== Full Suite (500-user peak) ==="
SYNTARO_URL="$SYNTARO_URL" k6 run --out json="$REPORT_DIR/full-suite.json" --summary-export="$REPORT_DIR/full-suite-summary.json" load-tests/scenarios/full-suite.js

echo "Reports: $REPORT_DIR"
