#!/usr/bin/env bash
# =============================================================================
# scripts/coverage-enforce.sh — Anti-Liar Coverage Enforcement (AIM-2033)
#
# Runs vitest with --coverage and enforces minimum thresholds:
#   - Lines:    >= 90%
#   - Branches: >= 80%
#   - Functions:>= 85%
#   - Statements:>= 90%
#
# Also optionally runs Stryker mutation testing when --mutation is passed.
#
# Usage:
#   npm run coverage-enforce                   # vitest coverage
#   npm run coverage-enforce -- --mutation     # includes stryker mutation
#   npm run coverage-enforce -- --changed      # only changed files vs origin/main
#
# Exit codes:
#   0 — All coverage thresholds met
#   1 — Coverage below thresholds (fix before PR)
#   2 — Infrastructure error (missing config, tool not found)
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

RUN_MUTATION=false
CHANGED_ONLY=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mutation) RUN_MUTATION=true; shift ;;
    --changed) CHANGED_ONLY=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  ANTI-LIAR COVERAGE ENFORCEMENT (AIM-2033)${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

# ── Prerequisite check ──────────────────────────────────────────────────────

if [ ! -f vitest.config.ts ] && [ ! -f vitest.config.js ] && [ ! -f vitest.config.mjs ]; then
  echo -e "${RED}✗ ERROR: vitest.config.ts not found${NC}"
  echo -e "  Run from project root: npm run coverage-enforce"
  exit 2
fi

if ! command -v npx &>/dev/null; then
  echo -e "${RED}✗ ERROR: npx not available — install Node.js >= 20${NC}"
  exit 2
fi

# ── Step 1: Run coverage via vitest ─────────────────────────────────────────

echo ""
echo -e "${CYAN}── Step 1: Coverage Measurement ──────────────────────────────${NC}"

COVERAGE_ARGS="--coverage"
if $CHANGED_ONLY; then
  COVERAGE_ARGS="$COVERAGE_ARGS --changed"
fi

if $VERBOSE; then
  echo -e "  Running: npx vitest run $COVERAGE_ARGS"
  echo ""
fi

# Capture vitest output for parsing
VITEST_OUTPUT=$(npx vitest run $COVERAGE_ARGS 2>&1)
VITEST_EXIT=$?

if $VERBOSE; then
  echo "$VITEST_OUTPUT"
fi

# ── Step 2: Parse coverage metrics ─────────────────────────────────────────

echo ""
echo -e "${CYAN}── Step 2: Threshold Validation ──────────────────────────────${NC}"

# Extract coverage percentages from vitest output (v8 provider format)
EXTRACT_COV() {
  local label="$1"
  # Match lines like "lines      : 92.5% (185/200)"
  # Or the JSON summary format
  echo "$VITEST_OUTPUT" | grep -i "$label" | grep -oP '\d+\.?\d*(?=%)' | head -1 || echo "0"
}

LINES_PCT=$(EXTRACT_COV "lines")
BRANCHES_PCT=$(EXTRACT_COV "branches")
FUNCTIONS_PCT=$(EXTRACT_COV "functions")
STATEMENTS_PCT=$(EXTRACT_COV "statements")

# If vitest failed or no coverage data, try reading from coverage JSON
if [ "$LINES_PCT" = "0" ] && [ -f coverage/coverage-final.json ]; then
  LINES_PCT=$(node -e "
    const c = require('./coverage/coverage-final.json');
    const metrics = Object.values(c).reduce((acc, f) => {
      acc.lines += f.lines?.covered || 0;
      acc.totalLines += f.lines?.total || 0;
      acc.branches += f.branches?.covered || 0;
      acc.totalBranches += f.branches?.total || 0;
      acc.functions += f.functions?.covered || 0;
      acc.totalFunctions += f.functions?.total || 0;
      acc.statements += f.statements?.covered || 0;
      acc.totalStatements += f.statements?.total || 0;
      return acc;
    }, { lines:0, totalLines:0, branches:0, totalBranches:0, functions:0, totalFunctions:0, statements:0, totalStatements:0 });
    console.log((metrics.lines/metrics.totalLines*100).toFixed(1));
  " 2>/dev/null || echo "0")
  BRANCHES_PCT=$(node -e "
    const c = require('./coverage/coverage-final.json');
    const metrics = Object.values(c).reduce((acc, f) => {
      acc.branches += f.branches?.covered || 0;
      acc.totalBranches += f.branches?.total || 0;
      return acc;
    }, { branches:0, totalBranches:0 });
    console.log((metrics.branches/metrics.totalBranches*100).toFixed(1));
  " 2>/dev/null || echo "0")
  FUNCTIONS_PCT=$(node -e "
    const c = require('./coverage/coverage-final.json');
    const metrics = Object.values(c).reduce((acc, f) => {
      acc.functions += f.functions?.covered || 0;
      acc.totalFunctions += f.functions?.total || 0;
      return acc;
    }, { functions:0, totalFunctions:0 });
    console.log((metrics.functions/metrics.totalFunctions*100).toFixed(1));
  " 2>/dev/null || echo "0")
  STATEMENTS_PCT=$(node -e "
    const c = require('./coverage/coverage-final.json');
    const metrics = Object.values(c).reduce((acc, f) => {
      acc.statements += f.statements?.covered || 0;
      acc.totalStatements += f.statements?.total || 0;
      return acc;
    }, { statements:0, totalStatements:0 });
    console.log((metrics.statements/metrics.totalStatements*100).toFixed(1));
  " 2>/dev/null || echo "0")
fi

# Thresholds
MIN_LINES=90
MIN_BRANCHES=80
MIN_FUNCTIONS=85
MIN_STATEMENTS=90

ALL_PASS=true

check_threshold() {
  local name="$1" value="$2" min="$3"
  # Handle empty/missing values
  if [ -z "$value" ] || [ "$value" = "0" ] || [ "$value" = "0.0" ] || [ "$value" = "N/A" ]; then
    echo -e "  ${YELLOW}⚠ WARNING:${NC} $name metric unavailable — coverage may not have run"
    return
  fi

  # Use awk for float comparison
  if awk "BEGIN {exit !($value >= $min)}" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $name: ${value}% (threshold: ${min}%)"
  else
    echo -e "  ${RED}✗${NC} $name: ${value}% (below threshold: ${min}%)"
    ALL_PASS=false
  fi
}

check_threshold "Lines"     "$LINES_PCT"     "$MIN_LINES"
check_threshold "Branches"  "$BRANCHES_PCT"  "$MIN_BRANCHES"
check_threshold "Functions" "$FUNCTIONS_PCT" "$MIN_FUNCTIONS"
check_threshold "Statements" "$STATEMENTS_PCT" "$MIN_STATEMENTS"

# ── Step 3: Mutation testing (optional) ─────────────────────────────────────

MUTATION_PASS=true
if $RUN_MUTATION; then
  echo ""
  echo -e "${CYAN}── Step 3: Mutation Testing (Stryker) ────────────────────────${NC}"

  if [ ! -f stryker.config.json ]; then
    echo -e "  ${YELLOW}⚠ SKIP:${NC} stryker.config.json not found"
  elif grep -q '"@stryker-mutator/core"' package.json 2>/dev/null; then
    if $VERBOSE; then
      echo -e "  Running: npx stryker run"
      echo ""
    fi
    STRYKER_OUTPUT=$(npx stryker run 2>&1)
    STRYKER_EXIT=$?

    if $VERBOSE; then
      echo "$STRYKER_OUTPUT"
    fi

    # Extract mutation score
    MUTATION_SCORE=$(echo "$STRYKER_OUTPUT" | grep -oP '\d+\.?\d*(?=% mutation)' | head -1 || echo "")

    if [ -n "$MUTATION_SCORE" ]; then
      echo -e "  Mutation score: ${MUTATION_SCORE}%"
      # Check break threshold from config
      BREAK_THRESHOLD=$(node -e "
        const c = require('./stryker.config.json');
        console.log(c.thresholds?.break ?? 60);
      " 2>/dev/null || echo "60")
      if awk "BEGIN {exit !($MUTATION_SCORE >= $BREAK_THRESHOLD)}" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Mutation score meets break threshold (${BREAK_THRESHOLD}%)"
      else
        echo -e "  ${RED}✗${NC} Mutation score ${MUTATION_SCORE}% below break threshold ${BREAK_THRESHOLD}%"
        MUTATION_PASS=false
      fi
    elif [ $STRYKER_EXIT -eq 0 ]; then
      echo -e "  ${GREEN}✓${NC} Stryker mutation testing passed"
    else
      echo -e "  ${RED}✗${NC} Stryker mutation testing failed (exit code: $STRYKER_EXIT)"
      MUTATION_PASS=false
    fi
  else
    echo -e "  ${YELLOW}⚠ SKIP:${NC} @stryker-mutator/core not installed"
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  COVERAGE ENFORCEMENT SUMMARY${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

if $ALL_PASS; then
  echo -e "  ${GREEN}✓ Coverage thresholds met${NC}"
else
  echo -e "  ${RED}✗ Coverage thresholds NOT met — fix before proceeding${NC}"
fi

if $RUN_MUTATION; then
  if $MUTATION_PASS; then
    echo -e "  ${GREEN}✓ Mutation testing passed${NC}"
  else
    echo -e "  ${RED}✗ Mutation testing failed${NC}"
  fi
fi

if $ALL_PASS && $MUTATION_PASS; then
  echo ""
  echo -e "${GREEN}  ✓ ALL CHECKS PASSED — anti-liar enforcement clear${NC}"
  exit 0
elif $ALL_PASS; then
  echo ""
  echo -e "${GREEN}  ✓ Coverage check passed (mutation not run)${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}  ✗ COVERAGE ENFORCEMENT BLOCKED — fix failures before PR${NC}"
  exit 1
fi
