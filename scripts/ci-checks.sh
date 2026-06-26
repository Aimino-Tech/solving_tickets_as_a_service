#!/usr/bin/env bash
# =============================================================================
# scripts/ci-checks.sh — STAS CI Checks Pipeline
#
# Runs 3 parallel code quality checks:
#   biome  — TypeScript/JS lint + formatting (via biome.json)
#   tsc    — TypeScript type checking (--noEmit)
#   ruff   — Python linting
#
# Usage:
#   ./scripts/ci-checks.sh                         # run all checks on full repo
#   ./scripts/ci-checks.sh --changed               # only changed files vs base
#   ./scripts/ci-checks.sh --tool=biome            # run a specific tool
#   ./scripts/ci-checks.sh --json                  # output results as JSON
#
# Dependencies: biome (via npx), tsc (via npx), ruff (pip package).
#
# Exit codes:
#   0 — All checks passed
#   1 — One or more tools not found (soft fail)
#   2 — One or more checks FAILED
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CHANGED_ONLY=false
SELECTED_TOOL=""
OUTPUT_JSON=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed) CHANGED_ONLY=true; shift ;;
    --tool=*) SELECTED_TOOL="${1#*=}"; shift ;;
    --json) OUTPUT_JSON=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Determine changed files ──────────────────────────────────────────────────
CHANGED_TS_FILES=""
CHANGED_PY_FILES=""

if $CHANGED_ONLY; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    BASE="${BASE_BRANCH:-origin/main}"
    CHANGED=$(git diff --name-only "$BASE"...HEAD --diff-filter=AM 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")
    if [ -n "$CHANGED" ]; then
      CHANGED_TS_FILES=$(echo "$CHANGED" | grep -E '\.(ts|tsx|mts|cts)$' | tr '\n' ' ' || true)
      CHANGED_PY_FILES=$(echo "$CHANGED" | grep -E '\.py$' | tr '\n' ' ' || true)
    fi
  fi
fi

# ── Result accumulator ────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
RESULTS_JSON="["

check_header() {
  local name="$1"
  echo ""
  echo -e "${CYAN}── $name ────────────────────────────────────────────────${NC}"
}

check_pass() {
  local tool="$1" msg="$2"
  echo -e "  ${GREEN}✓ PASS:${NC} $tool — $msg"
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS_JSON="${RESULTS_JSON}{\"tool\":\"$tool\",\"passed\":true,\"message\":\"$msg\"},"
}

check_fail() {
  local tool="$1" msg="$2"
  echo -e "  ${RED}✗ FAIL:${NC} $tool — $msg"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS_JSON="${RESULTS_JSON}{\"tool\":\"$tool\",\"passed\":false,\"message\":\"$msg\"},"
}

check_skip() {
  local tool="$1" msg="$2"
  echo -e "  ${YELLOW}— SKIP:${NC} $tool — $msg"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  RESULTS_JSON="${RESULTS_JSON}{\"tool\":\"$tool\",\"passed\":null,\"message\":\"$msg\"},"
}

run_tool() {
  local tool="$1"
  if [ -n "$SELECTED_TOOL" ] && [ "$SELECTED_TOOL" != "$tool" ]; then
    return 1
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  CI CHECKS — biome + tsc + ruff${NC}"
if $CHANGED_ONLY; then
  echo -e "${CYAN}  Mode: changed files only (vs $BASE)${NC}"
fi
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

# ══════════════════════════════════════════════════════════════════════════════
# biome — TypeScript/JS lint + formatting
# ══════════════════════════════════════════════════════════════════════════════
check_header "biome — JS/TS lint & format"
if run_tool "biome"; then
  if command -v npx >/dev/null 2>&1 && [ -f biome.json ]; then
    BIOME_ARGS=("check")
    if [ -n "$CHANGED_TS_FILES" ]; then
      # shellcheck disable=SC2086
      BIOME_OUTPUT=$(npx biome check $CHANGED_TS_FILES 2>&1 || true)
    else
      BIOME_OUTPUT=$(npx biome check --changed --since="${BASE:-origin/main}" 2>&1 || true)
    fi
    BIOME_EXIT=$?
    if [ "$BIOME_EXIT" -eq 0 ]; then
      check_pass "biome" "All files pass lint & format checks"
    else
      ERROR_COUNT=$(echo "$BIOME_OUTPUT" | grep -cE '(error|✗)' 2>/dev/null || echo "0")
      SUMMARY=$(echo "$BIOME_OUTPUT" | tail -5 | tr '\n' '; ')
      check_fail "biome" "$ERROR_COUNT issue(s) found — $SUMMARY"
      echo "$BIOME_OUTPUT" | while IFS= read -r line; do
        echo "    $line"
      done
    fi
  else
    check_skip "biome" "npx or biome.json not found — skipping"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# tsc — TypeScript type checking
# ══════════════════════════════════════════════════════════════════════════════
check_header "tsc — TypeScript type checking"
if run_tool "tsc"; then
  if command -v npx >/dev/null 2>&1 && [ -f tsconfig.json ]; then
    TSC_OUTPUT=$(npx tsc --noEmit 2>&1 || true)
    TSC_EXIT=$?
    if [ "$TSC_EXIT" -eq 0 ]; then
      check_pass "tsc" "TypeScript compilation clean — no errors"
    else
      ERROR_COUNT=$(echo "$TSC_OUTPUT" | grep -cE 'error TS' 2>/dev/null || echo "0")
      check_fail "tsc" "$ERROR_COUNT type error(s) found"
      echo "$TSC_OUTPUT" | head -30 | while IFS= read -r line; do
        echo "    $line"
      done
      if [ "$(echo "$TSC_OUTPUT" | wc -l)" -gt 30 ]; then
        echo "    ... (output truncated)"
      fi
    fi
  else
    check_skip "tsc" "npx or tsconfig.json not found — skipping"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# ruff — Python linting
# ══════════════════════════════════════════════════════════════════════════════
check_header "ruff — Python lint"
if run_tool "ruff"; then
  if command -v ruff >/dev/null 2>&1 || python3 -m ruff --version >/dev/null 2>&1; then
    RUFF_CMD=""
    if command -v ruff >/dev/null 2>&1; then
      RUFF_CMD="ruff"
    else
      RUFF_CMD="python3 -m ruff"
    fi

    if [ -n "$CHANGED_PY_FILES" ]; then
      # shellcheck disable=SC2086
      RUFF_OUTPUT=$($RUFF_CMD check $CHANGED_PY_FILES 2>&1 || true)
    else
      RUFF_OUTPUT=$($RUFF_CMD check workers/ 2>&1 || true)
    fi
    RUFF_EXIT=$?
    if [ "$RUFF_EXIT" -eq 0 ]; then
      check_pass "ruff" "All Python files pass lint checks"
    else
      ERROR_COUNT=$(echo "$RUFF_OUTPUT" | grep -cE '^[A-Z][0-9]+' 2>/dev/null || echo "0")
      check_fail "ruff" "Lint errors found — run 'ruff check workers/' for details"
      echo "$RUFF_OUTPUT" | head -30 | while IFS= read -r line; do
        echo "    $line"
      done
    fi
  else
    check_skip "ruff" "ruff not installed — run 'pip install ruff'"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
RESULTS_JSON="${RESULTS_JSON%,}]"

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  CI CHECKS SUMMARY${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC} $PASS_COUNT"
echo -e "  ${RED}Failed:${NC} $FAIL_COUNT"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP_COUNT"

if $OUTPUT_JSON; then
  echo ""
  echo "$RESULTS_JSON"
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo -e "${RED}  ✗ CHECKS FAILED — fix errors before proceeding${NC}"
  exit 2
else
  echo -e "${GREEN}  ✓ ALL CHECKS PASSED${NC}"
  exit 0
fi
