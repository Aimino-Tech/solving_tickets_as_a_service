#!/usr/bin/env bash
# STAS Launch Checklist — Automated Pre-Flight Verification
#
# Usage:
#   ./scripts/launch-checklist.sh           # Run full checklist
#   ./scripts/launch-checklist.sh --quick   # Skip Docker/tests
#   ./scripts/launch-checklist.sh --json    # Machine-readable output
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more critical checks failed
#   2 - Infrastructure failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
CHECKS_PASSED=0; CHECKS_FAILED=0; CHECKS_SKIPPED=0; CHECKS_TOTAL=0
JSON_OUTPUT=false; QUICK_MODE=false

log_info()    { echo -e "${BLUE}[CHECK]${NC} $1"; }
log_passed()  { echo -e "  ${GREEN}✓${NC} $1"; ((CHECKS_PASSED++)); }
log_failed()  { echo -e "  ${RED}✗${NC} $1"; ((CHECKS_FAILED++)); }
log_skipped() { echo -e "  ${YELLOW}∼${NC} $1"; ((CHECKS_SKIPPED++)); }

run_check() {
  local name="$1"; local cmd="$2"; local critical="${3:-false}"
  ((CHECKS_TOTAL++))
  log_info "$name"
  if eval "$cmd" &>/dev/null; then
    log_passed "$name"
    return 0
  else
    if [[ "$critical" == "true" ]]; then
      log_failed "$name (CRITICAL)"
      return 1
    else
      log_failed "$name"
      return 0
    fi
  fi
}

print_json_result() {
  echo "{"
  echo "  \"total\": $CHECKS_TOTAL,"
  echo "  \"passed\": $CHECKS_PASSED,"
  echo "  \"failed\": $CHECKS_FAILED,"
  echo "  \"skipped\": $CHECKS_SKIPPED,"
  echo "  \"status\": \"$([[ $CHECKS_FAILED -gt 0 ]] && echo 'FAIL' || echo 'PASS')\""
  echo "}"
}

# Parse args
while [[ $# -gt 0 ]]; do case "$1" in
  --quick|-q) QUICK_MODE=true; shift ;;
  --json|-j)  JSON_OUTPUT=true; shift ;;
  --help|-h)  echo "Usage: $0 [--quick|--json]"; exit 0 ;;
  *) echo "Unknown: $1"; exit 1 ;;
esac; done

echo "=============================================="
echo "  STAS Launch Checklist"
echo "=============================================="

echo ""; echo "─ Environment ──────────────────────────────"
run_check "Node.js installed" "command -v node" true
run_check "npm installed" "command -v npm" true
run_check "Git installed" "command -v git" true
run_check "GitHub CLI installed" "command -v gh" false
run_check "Docker installed" "command -v docker" false
run_check "GITHUB_TOKEN set" "[[ -n \"\${GITHUB_TOKEN-}\" ]]" true
run_check "Git origin reachable" "cd $PROJECT_ROOT && git fetch origin --dry-run 2>&1 | head -1" true

echo ""; echo "─ Code Health ──────────────────────────────"
run_check "No unstaged changes" "cd $PROJECT_ROOT && git diff --quiet" false
run_check "On main branch" "cd $PROJECT_ROOT && [[ \$(git rev-parse --abbrev-ref HEAD) == 'main' ]]" false
run_check "No TODO/FIXME stubs" "! grep -r 'TODO\\|FIXME' $PROJECT_ROOT/src --include='*.ts' --exclude='*test*' -l 2>/dev/null | head -1" false

echo ""; echo "─ Build ─────────────────────────────────────"
run_check "TypeScript compiles" "cd $PROJECT_ROOT && npx tsc --noEmit" false
run_check "Build output exists" "ls $PROJECT_ROOT/dist/*.js 2>/dev/null | head -1" false

echo ""; echo "─ Tests ─────────────────────────────────────"
if [[ "$QUICK_MODE" == false ]]; then
  run_check "Unit tests pass" "cd $PROJECT_ROOT && npx vitest run --reporter=silent 2>&1" false
else
  log_skipped "Unit tests (--quick mode)"
fi

echo ""; echo "─ Docker ────────────────────────────────────"
if [[ "$QUICK_MODE" == false ]]; then
  run_check "Docker compose config valid" "cd $PROJECT_ROOT && docker compose config -q 2>/dev/null" false
else
  log_skipped "Docker compose validation (--quick mode)"
fi

echo ""; echo "─ Secrets ───────────────────────────────────"
run_check ".env file present" "[[ -f $PROJECT_ROOT/.env ]]" false
run_check "No secrets committed" "! grep -r 'ghp_\\|gho_\\|ghu_\\|ghs_' $PROJECT_ROOT/src --include='*.ts' -l 2>/dev/null | head -1" true

echo ""; echo "=============================================="
echo "  Results: $CHECKS_PASSED/$CHECKS_TOTAL passed"
echo "=============================================="

if [[ "$JSON_OUTPUT" == true ]]; then
  print_json_result
fi

if [[ $CHECKS_FAILED -gt 0 ]]; then
  echo -e "${RED}Some checks failed.${NC}"
  [[ $CHECKS_PASSED -gt 0 ]] && echo "  $CHECKS_PASSED passed"
  echo "  $CHECKS_FAILED failed"
  echo "  $CHECKS_SKIPPED skipped"
  echo "  $CHECKS_TOTAL total"
  exit 1
fi

echo -e "${GREEN}All checks passed — ready for launch!${NC}"
exit 0
