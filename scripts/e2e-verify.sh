#!/usr/bin/env bash
# =============================================================================
# scripts/e2e-verify.sh — E2E Build/Test Verification Pipeline
#
# Runs all verification stages in sequence:
#   Stage 1 — Build (npm run build / tsc)
#   Stage 2 — Unit tests with coverage (vitest run --coverage)
#   Stage 3 — Integration tests (testcontainers via vitest)
#   Stage 4 — E2E tests (playwright via vitest)
#
# Each stage is optional via flags. Without flags, all stages run.
# The script outputs a PASS/FAIL report with coverage metrics.
#
# Usage:
#   bash scripts/e2e-verify.sh                       # run all stages
#   bash scripts/e2e-verify.sh --stage=1             # build only
#   bash scripts/e2e-verify.sh --skip=3,4            # skip integration + e2e
#   bash scripts/e2e-verify.sh --json                # JSON output
#   bash scripts/e2e-verify.sh --report=path/to/report.md  # write report to file
#
# Exit codes:
#   0 — All stages PASSED
#   1 — One or more stages FAILED (non-blocking for advisory stages)
#   2 — Critical stage(s) FAILED (build + unit tests)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Parse arguments ────────────────────────────────────────────────────────────

RUN_ALL=true
STAGES=""
SKIP_STAGES=""
OUTPUT_JSON=false
REPORT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage=*) RUN_ALL=false; STAGES="${1#*=}"; shift ;;
    --skip=*) SKIP_STAGES="${1#*=}"; shift ;;
    --json) OUTPUT_JSON=true; shift ;;
    --report=*) REPORT_FILE="${1#*=}"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
STAGE_RESULTS=()

stage_header() {
  local n="$1" name="$2"
  echo ""
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  Stage $n: $name${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
}

stage_pass() {
  local name="$1" detail="$2" duration="$3"
  echo -e "  ${GREEN}✓ PASS:${NC} $name — $detail (${duration}s)"
  PASS_COUNT=$((PASS_COUNT + 1))
  STAGE_RESULTS+=("{\"stage\":\"$name\",\"result\":\"pass\",\"detail\":\"$detail\",\"duration\":$duration}")
}

stage_fail() {
  local name="$1" detail="$2" duration="$3"
  echo -e "  ${RED}✗ FAIL:${NC} $name — $detail (${duration}s)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  STAGE_RESULTS+=("{\"stage\":\"$name\",\"result\":\"fail\",\"detail\":\"$detail\",\"duration\":$duration}")
}

stage_skip() {
  local name="$1" reason="$2"
  echo -e "  ${YELLOW}— SKIP:${NC} $name ($reason)"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  STAGE_RESULTS+=("{\"stage\":\"$name\",\"result\":\"skip\",\"detail\":\"$reason\",\"duration\":0}")
}

is_stage_enabled() {
  local n="$1"
  if [ -n "$SKIP_STAGES" ]; then
    IFS=',' read -ra SKIP <<< "$SKIP_STAGES"
    for s in "${SKIP[@]}"; do
      if [ "$s" = "$n" ]; then return 1; fi
    done
  fi
  if [ "$RUN_ALL" = true ]; then return 0; fi
  IFS=',' read -ra ENABLED <<< "$STAGES"
  for s in "${ENABLED[@]}"; do
    if [ "$s" = "$n" ]; then return 0; fi
  done
  return 1
}

# ── Timestamp ──────────────────────────────────────────────────────────────────

START_TIME=$(date +%s)
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  E2E VERIFICATION PIPELINE${NC}"
echo -e "${CYAN}  Started: $(date)${NC}"
echo -e "${CYAN}  Project: $ROOT${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build
# ──────────────────────────────────────────────────────────────────────────────

stage_header "1" "Build (TypeScript compilation)"
if is_stage_enabled "1"; then
  STAGE_START=$(date +%s)
  echo -e "  ${CYAN}Running: npm run build${NC}"

  if npm run build 2>&1; then
    stage_pass "build" "TypeScript compilation completed" $(( $(date +%s) - STAGE_START ))
  else
    stage_fail "build" "TypeScript compilation failed" $(( $(date +%s) - STAGE_START ))
  fi
else
  stage_skip "build" "disabled by --stage or --skip filter"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Unit tests with coverage
# ──────────────────────────────────────────────────────────────────────────────

stage_header "2" "Unit tests (vitest with coverage)"
if is_stage_enabled "2"; then
  STAGE_START=$(date +%s)
  echo -e "  ${CYAN}Running: npx vitest run --coverage${NC}"

  # Capture coverage summary
  COVERAGE_OUTPUT=$(npx vitest run --coverage 2>&1) && TEST_EXIT=0 || TEST_EXIT=$?

  # Extract coverage metrics from output
  COVERAGE_LINES=$(echo "$COVERAGE_OUTPUT" | grep -oP 'Lines\s*:\s*\d+\.?\d*%' | grep -oP '\d+\.?\d*(?=%)' || echo "0")
  COVERAGE_BRANCHES=$(echo "$COVERAGE_OUTPUT" | grep -oP 'Branches\s*:\s*\d+\.?\d*%' | grep -oP '\d+\.?\d*(?=%)' || echo "0")
  COVERAGE_FUNCTIONS=$(echo "$COVERAGE_OUTPUT" | grep -oP 'Functions\s*:\s*\d+\.?\d*%' | grep -oP '\d+\.?\d*(?=%)' || echo "0")
  COVERAGE_STATEMENTS=$(echo "$COVERAGE_OUTPUT" | grep -oP 'Statements\s*:\s*\d+\.?\d*%' | grep -oP '\d+\.?\d*(?=%)' || echo "0")

  if [ "$TEST_EXIT" -eq 0 ]; then
    stage_pass "unit-tests" "All tests passed (Lines: ${COVERAGE_LINES}%, Branches: ${COVERAGE_BRANCHES}%, Functions: ${COVERAGE_FUNCTIONS}%, Statements: ${COVERAGE_STATEMENTS}%)" $(( $(date +%s) - STAGE_START ))
  else
    stage_fail "unit-tests" "Test failures detected (Lines: ${COVERAGE_LINES}%, Branches: ${COVERAGE_BRANCHES}%, Functions: ${COVERAGE_FUNCTIONS}%, Statements: ${COVERAGE_STATEMENTS}%)" $(( $(date +%s) - STAGE_START ))
  fi

  # Print coverage table
  echo ""
  echo -e "  ${CYAN}Coverage Summary:${NC}"
  printf "  %-15s %s\n" "Lines:" "${COVERAGE_LINES:-N/A}%"
  printf "  %-15s %s\n" "Branches:" "${COVERAGE_BRANCHES:-N/A}%"
  printf "  %-15s %s\n" "Functions:" "${COVERAGE_FUNCTIONS:-N/A}%"
  printf "  %-15s %s\n" "Statements:" "${COVERAGE_STATEMENTS:-N/A}%"
else
  stage_skip "unit-tests" "disabled by --stage or --skip filter"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3 — Integration tests (testcontainers)
# ──────────────────────────────────────────────────────────────────────────────

stage_header "3" "Integration tests (testcontainers)"
if is_stage_enabled "3"; then
  STAGE_START=$(date +%s)
  echo -e "  ${CYAN}Running: npx vitest run --config vitest.integration.config.ts${NC}"

  if npx vitest run --config vitest.integration.config.ts 2>&1; then
    stage_pass "integration-tests" "All integration tests passed" $(( $(date +%s) - STAGE_START ))
  else
    stage_fail "integration-tests" "Integration test failures detected" $(( $(date +%s) - STAGE_START ))
  fi
else
  stage_skip "integration-tests" "disabled by --stage or --skip filter"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Stage 4 — E2E tests (playwright/vitest)
# ──────────────────────────────────────────────────────────────────────────────

stage_header "4" "E2E tests (playwright)"
if is_stage_enabled "4"; then
  STAGE_START=$(date +%s)
  echo -e "  ${CYAN}Running: npx vitest run --config vitest.e2e.config.ts${NC}"

  if npx vitest run --config vitest.e2e.config.ts 2>&1; then
    stage_pass "e2e-tests" "All E2E tests passed" $(( $(date +%s) - STAGE_START ))
  else
    stage_fail "e2e-tests" "E2E test failures detected" $(( $(date +%s) - STAGE_START ))
  fi
else
  stage_skip "e2e-tests" "disabled by --stage or --skip filter"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────

TOTAL_DURATION=$(( $(date +%s) - START_TIME ))

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  VERIFICATION SUMMARY${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC} $PASS_COUNT"
echo -e "  ${RED}Failed:${NC} $FAIL_COUNT"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP_COUNT"
echo -e "  Duration: ${TOTAL_DURATION}s"

# Overall verdict
if [ "$FAIL_COUNT" -gt 0 ]; then
  # Check if stage 1 or 2 failed (critical)
  CRITICAL_FAIL=false
  for result in "${STAGE_RESULTS[@]}"; do
    if echo "$result" | grep -q '"stage":"build"'; then CRITICAL_FAIL=true; fi
    if echo "$result" | grep -q '"stage":"unit-tests"'; then CRITICAL_FAIL=true; fi
  done

  if [ "$CRITICAL_FAIL" = true ]; then
    echo -e "\n${RED}${BOLD}  ✗ VERIFICATION FAILED — Critical stage(s) failed${NC}"
    echo -e "${YELLOW}  Fix build and/or unit test failures before proceeding${NC}"
    EXIT_CODE=2
  else
    echo -e "\n${YELLOW}${BOLD}  ⚠ VERIFICATION FAILED — Non-critical stage(s) failed${NC}"
    echo -e "${YELLOW}  Review output above for details${NC}"
    EXIT_CODE=1
  fi
else
  echo -e "\n${GREEN}${BOLD}  ✓ ALL STAGES PASSED${NC}"
  EXIT_CODE=0
fi

# ── Write report file ──────────────────────────────────────────────────────────
if [ -n "$REPORT_FILE" ]; then
  {
    echo "# E2E Verification Report"
    echo ""
    echo "**Date**: $(date)"
    echo "**Duration**: ${TOTAL_DURATION}s"
    echo "**Passed**: $PASS_COUNT"
    echo "**Failed**: $FAIL_COUNT"
    echo "**Skipped**: $SKIP_COUNT"
    echo ""
    echo "## Results"
    echo ""
    echo "| Stage | Result | Detail |"
    echo "|-------|--------|--------|"
    for result in "${STAGE_RESULTS[@]}"; do
      STAGE=$(echo "$result" | grep -oP '"stage":"[^"]*"' | sed 's/"stage":"//;s/"//')
      RES=$(echo "$result" | grep -oP '"result":"[^"]*"' | sed 's/"result":"//;s/"//')
      DETAIL=$(echo "$result" | grep -oP '"detail":"[^"]*"' | sed 's/"detail":"//;s/"//')
      echo "| $STAGE | $RES | $DETAIL |"
    done
  } > "$REPORT_FILE"
  echo -e "\n${CYAN}Report written to: $REPORT_FILE${NC}"
fi

# ── JSON output ────────────────────────────────────────────────────────────────
if [ "$OUTPUT_JSON" = true ]; then
  JSON_RESULTS=$(printf '%s\n' "${STAGE_RESULTS[@]}" | jq -s '.' 2>/dev/null || echo "[]")
  echo ""
  echo -e "${CYAN}JSON Output:${NC}"
  echo "{
  \"passed\": $PASS_COUNT,
  \"failed\": $FAIL_COUNT,
  \"skipped\": $SKIP_COUNT,
  \"duration\": $TOTAL_DURATION,
  \"exitCode\": $EXIT_CODE,
  \"stages\": $JSON_RESULTS
}"
fi

exit "$EXIT_CODE"
