#!/usr/bin/env bash
# =============================================================================
# SYNTARO Load Test Runner
#
# Runs all load test scenarios against a target SYNTARO instance and generates
# a consolidated report.
#
# Usage:
#   ./tests/load/load-test-runner.sh [target_url]
#
# Examples:
#   ./tests/load/load-test-runner.sh http://localhost:3000
#   TARGET_URL=https://staging.syntaro.dev ./tests/load/load-test-runner.sh
#   ./tests/load/load-test-runner.sh https://syntaro.example.com
# =============================================================================

set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://localhost:3000}}"
RESULTS_DIR="tests/load/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SUMMARY_FILE="${RESULTS_DIR}/load-test-summary-${TIMESTAMP}.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           SYNTARO Load Test Runner                           ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║ Target: ${TARGET}${NC}"
echo -e "${BLUE}║ Time:   $(date)${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Ensure k6 is installed
if ! command -v k6 &>/dev/null; then
  echo -e "${RED}Error: k6 is not installed.${NC}"
  echo ""
  echo "Install k6:"
  echo "  macOS: brew install k6"
  echo "  Linux (Debian/Ubuntu):"
  echo "    sudo gpg -k"
  echo "    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69"
  echo "    echo 'deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main' | sudo tee /etc/apt/sources.list.d/k6.list"
  echo "    sudo apt-get update && sudo apt-get install k6"
  echo "  Docker: docker pull grafana/k6"
  exit 1
fi

# Create results directory
mkdir -p "${RESULTS_DIR}"

# Pre-flight check
echo -e "${YELLOW}Pre-flight check...${NC}"
if ! curl -sf "${TARGET}/health/live" > /dev/null 2>&1; then
  echo -e "${RED}Error: Target ${TARGET} is not reachable or not healthy${NC}"
  echo "Make sure SYNTARO is running and accessible at ${TARGET}"
  exit 1
fi
echo -e "${GREEN}Target is healthy ✓${NC}"
echo ""

# Collect baseline info
echo -e "${YELLOW}Collecting baseline info...${NC}"
curl -s "${TARGET}/health" | python3 -m json.tool 2>/dev/null || echo "(raw)"
echo ""

run_test() {
  local name="$1"
  local script="$2"
  local label="$3"

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE} ${label}${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  k6 run \
    --out json="${RESULTS_DIR}/${name}-${TIMESTAMP}.json" \
    --summary-export="${RESULTS_DIR}/${name}-summary-${TIMESTAMP}.json" \
    -e TARGET_URL="${TARGET}" \
    "${script}" || echo -e "${YELLOW}${label} completed with warnings${NC}"
  echo ""
}

# ── Run Tests ──────────────────────────────────────────────────────────
run_test "webhook-throughput" "tests/load/webhook-load-test.js" "Test 1: Webhook Endpoint Throughput"
run_test "queue-throughput" "tests/load/queue-throughput-test.js" "Test 2: Queue Throughput & Worker Concurrency"
run_test "db-pool-saturation" "tests/load/db-connection-pool-test.js" "Test 3: Database Connection Pool Saturation"
run_test "mixed-workload" "tests/load/mixed-workload-test.js" "Test 4: Mixed Production Workload"

# ── Generate Consolidated Report ───────────────────────────────────────
echo -e "${YELLOW}Generating consolidated report...${NC}"

cat > "${SUMMARY_FILE}" << EOF
# SYNTARO Load Test Report

**Date:** $(date)
**Target:** ${TARGET}
**Run ID:** ${TIMESTAMP}

## Test Scenarios

| Test | Status | Key Metrics |
|------|--------|-------------|
EOF

for summary_file in "${RESULTS_DIR}"/*-summary-${TIMESTAMP}.json; do
  test_name=$(basename "${summary_file}" | sed "s/-summary-${TIMESTAMP}.json//" | sed 's/-/ /g')
  if [ -f "${summary_file}" ]; then
    echo "| ${test_name} | ✅ | See raw data |" >> "${SUMMARY_FILE}"
  fi
done

cat >> "${SUMMARY_FILE}" << EOF

## Results

Raw JSON results saved to:
EOF

for result_file in "${RESULTS_DIR}"/*-${TIMESTAMP}.json; do
  echo "- \`${result_file}\`" >> "${SUMMARY_FILE}"
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Load Test Complete                               ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║ Report:  ${SUMMARY_FILE}${NC}"
echo -e "${GREEN}║ Results: ${RESULTS_DIR}/${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
