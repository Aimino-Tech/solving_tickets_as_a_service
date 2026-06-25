#!/usr/bin/env bash
# =============================================================================
# scripts/leave-it-cleaner.sh — "Leave It Cleaner Than You Found It" Gate
#
# Enforces lsp_diagnostics + test suite on every touched file in a PR/branch.
# Integrates with the Python cleaner_gate module for structured gate results.
#
# Usage:
#   bash scripts/leave-it-cleaner.sh                    # full gate (both checks)
#   bash scripts/leave-it-cleaner.sh --skip-lsp         # test suite only
#   bash scripts/leave-it-cleaner.sh --skip-tests       # LSP only
#   bash scripts/leave-it-cleaner.sh --json             # JSON output
#   bash scripts/leave-it-cleaner.sh --files="src/app.ts,src/lib.ts"  # specific files
#
# Environment:
#   CI=true                          Set when running in GitHub Actions
#   BASE_BRANCH=origin/main          Base branch for git diff
#   CLEANER_GATE_LSP_TIMEOUT=120000  LSP timeout in ms (default: 120000)
#   CLEANER_GATE_TEST_TIMEOUT=180000 Test timeout in ms (default: 180000)
#
# Exit codes:
#   0 — All gates PASSED
#   1 — One or more gates FAILED
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SKIP_LSP=false
SKIP_TESTS=false
JSON_OUTPUT=false
SPECIFIC_FILES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-lsp) SKIP_LSP=true; shift ;;
    --skip-tests) SKIP_TESTS=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --files=*) SPECIFIC_FILES="${1#*=}"; shift ;;
    --files) SPECIFIC_FILES="$2"; shift 2 ;;
    --base=*) export BASE_BRANCH="${1#*=}"; shift ;;
    --base) export BASE_BRANCH="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --skip-lsp          Skip LSP diagnostics gate"
      echo "  --skip-tests        Skip test suite gate"
      echo "  --json              Output results as JSON"
      echo "  --files=<paths>     Comma-separated file paths to check"
      echo "  --base=<branch>     Base branch for git diff"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  LEAVE IT CLEANER THAN YOU FOUND IT${NC}"
echo -e "${CYAN}  Gate: lsp_diagnostics + test suite enforcement${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

declare -a FILE_ARGS=()
if [ -n "$SPECIFIC_FILES" ]; then
  IFS=',' read -ra PARTS <<< "$SPECIFIC_FILES"
  for part in "${PARTS[@]}"; do
    FILE_ARGS+=("$part")
  done
  echo -e "${CYAN}  Files (explicit): ${FILE_ARGS[*]}${NC}"
else
  echo -e "${CYAN}  Files: auto-detected from git diff${NC}"
fi

PYTHON_CMD="python3"
if ! command -v python3 &>/dev/null; then
  if command -v python &>/dev/null; then
    PYTHON_CMD="python"
  else
    echo -e "${RED}[ERROR] Python 3 not found${NC}"
    exit 1
  fi
fi

PY_ARGS=("workers/quality/cleaner_gate.py")
$SKIP_LSP && PY_ARGS+=("--skip-lsp")
$SKIP_TESTS && PY_ARGS+=("--skip-tests")
$JSON_OUTPUT && PY_ARGS+=("--json")
if [ ${#FILE_ARGS[@]} -gt 0 ]; then
  PY_ARGS+=("--files")
  PY_ARGS+=("${FILE_ARGS[@]}")
fi

echo ""
echo -e "${CYAN}  Running: $PYTHON_CMD ${PY_ARGS[*]}${NC}"
echo ""

START_TIME=$(date +%s%N)
set +e
"$PYTHON_CMD" "${PY_ARGS[@]}"
EXIT_CODE=$?
set -e
END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}  ✓ LEAVE IT CLEANER — ALL GATES PASSED${NC}"
else
  echo -e "${RED}  ✗ LEAVE IT CLEANER — GATES FAILED${NC}"
fi
echo -e "${CYAN}  Duration: ${DURATION_MS}ms${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"

exit $EXIT_CODE
