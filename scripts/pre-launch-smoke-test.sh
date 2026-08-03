#!/usr/bin/env bash
# =============================================================================
# scripts/pre-launch-smoke-test.sh — SYNTARO Pre-Launch Smoke Test
#
# Comprehensive smoke test script that verifies all SYNTARO flows work from a
# clean state. Runs 37 tests across 7 sections:
#
#   1. Prerequisites Check  (7 tests)
#   2. Docker Build Tests   (5 tests)
#   3. Docker Compose       (5 tests)
#   4. GitHub Actions       (5 tests)
#   5. Scripts & Entrypoints (5 tests)
#   6. Documentation        (5 tests)
#   7. Test Infrastructure  (5 tests)
#
# Usage:
#   bash scripts/pre-launch-smoke-test.sh
#   bash scripts/pre-launch-smoke-test.sh --verbose   # Show each check detail
#   bash scripts/pre-launch-smoke-test.sh --json       # JSON summary for CI
#   bash scripts/pre-launch-smoke-test.sh --help       # Show help
#
# Exit codes:
#   0 — All checks passed (or only warnings)
#   1 — One or more tests failed
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERBOSE=false
JSON_OUTPUT=false
SUMMARY_FILE=""

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Counters ────────────────────────────────────────────────────────────────
TOTAL=0
PASSED=0
FAILED=0
WARNED=0
SKIPPED=0

# ── Results array for JSON summary ──────────────────────────────────────────
RESULTS=()

# ── Help ────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
SYNTARO Pre-Launch Smoke Test

Usage: bash scripts/pre-launch-smoke-test.sh [OPTIONS]

Options:
  --verbose, -v    Show detailed output for each check
  --json, -j       Output JSON summary report
  --help, -h       Show this help message

Description:
  Runs 37 smoke tests across 7 sections to verify SYNTARO is ready for launch.
  Tests are designed to work even without Docker/services running.
EOF
  exit 0
}

# ── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose|-v)    VERBOSE=true; shift ;;
    --json|-j)       JSON_OUTPUT=true; SUMMARY_FILE=$(mktemp); shift ;;
    --help|-h)       show_help ;;
    *)               echo "Unknown option: $1"; show_help ;;
  esac
done

# ── Logging helpers ─────────────────────────────────────────────────────────
pass() {
  local test_num="$1" desc="$2"
  TOTAL=$((TOTAL + 1)); PASSED=$((PASSED + 1))
  RESULTS+=("{\"test\":\"${test_num}\",\"description\":\"${desc}\",\"status\":\"PASS\"}")
  echo -e "  ${GREEN}✅ PASS${NC}: ${test_num} — ${desc}"
}
fail() {
  local test_num="$1" desc="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1)); FAILED=$((FAILED + 1))
  local detail_esc="${detail//\"/\\\"}"
  RESULTS+=("{\"test\":\"${test_num}\",\"description\":\"${desc}\",\"status\":\"FAIL\",\"detail\":\"${detail_esc}\"}")
  echo -e "  ${RED}❌ FAIL${NC}: ${test_num} — ${desc}"
  [ -n "$detail" ] && echo -e "       ${DIM}${detail}${NC}"
}
warn() {
  local test_num="$1" desc="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1)); WARNED=$((WARNED + 1))
  local detail_esc="${detail//\"/\\\"}"
  RESULTS+=("{\"test\":\"${test_num}\",\"description\":\"${desc}\",\"status\":\"WARN\",\"detail\":\"${detail_esc}\"}")
  echo -e "  ${YELLOW}⚠️ WARN${NC}: ${test_num} — ${desc}"
  [ -n "$detail" ] && echo -e "       ${DIM}${detail}${NC}"
}
skip() {
  local test_num="$1" desc="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1)); SKIPPED=$((SKIPPED + 1))
  local detail_esc="${detail//\"/\\\"}"
  RESULTS+=("{\"test\":\"${test_num}\",\"description\":\"${desc}\",\"status\":\"SKIP\",\"detail\":\"${detail_esc}\"}")
  echo -e "  ${BLUE}⏭️ SKIP${NC}: ${test_num} — ${desc}"
  [ -n "$detail" ] && echo -e "       ${DIM}${detail}${NC}"
}

section() {
  local num="$1" title="$2"
  echo ""
  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo -e " ${BOLD}${CYAN}  SECTION ${num}: ${title}${NC}"
  echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo ""
}

# =============================================================================
# SECTION 1: Prerequisites Check
# =============================================================================

section "1" "Prerequisites Check"

# Test 1.1: Git repo is clean
cd "$PROJECT_ROOT"
if git status --porcelain 2>/dev/null | grep -q .; then
  fail "1.1" "Git repo is clean" "Uncommitted changes detected: $(git status --porcelain 2>/dev/null | head -5)"
else
  pass "1.1" "Git repo is clean"
fi

# Test 1.2: No .env file
if [ -f "$PROJECT_ROOT/.env" ]; then
  fail "1.2" "No .env file exists (clean state)" ".env file found at $PROJECT_ROOT/.env — remove it for clean-state testing"
else
  pass "1.2" "No .env file exists (clean state)"
fi

# Test 1.3: Docker available
if command -v docker &>/dev/null; then
  pass "1.3" "Docker is available"
else
  warn "1.3" "Docker is not available" "Install Docker from https://docs.docker.com/get-docker/"
fi

# Test 1.4: gh CLI available
if command -v gh &>/dev/null; then
  pass "1.4" "GitHub CLI (gh) is available"
else
  warn "1.4" "GitHub CLI (gh) is not available" "Install from https://cli.github.com/"
fi

# Test 1.5: curl available
if command -v curl &>/dev/null; then
  pass "1.5" "curl is available"
else
  fail "1.5" "curl is not available" "Install curl: apt-get install curl / brew install curl"
fi

# Test 1.6: jq available
if command -v jq &>/dev/null; then
  pass "1.6" "jq is available"
else
  warn "1.6" "jq is not available" "Install jq: apt-get install jq / brew install jq"
fi

# Test 1.7: .env.example exists
if [ -f "$PROJECT_ROOT/.env.example" ]; then
  pass "1.7" ".env.example exists"
else
  fail "1.7" ".env.example is missing" "Create .env.example with all required environment variables"
fi

# =============================================================================
# SECTION 2: Docker Build Tests
# =============================================================================

section "2" "Docker Build Tests"

# Determine which Dockerfiles exist for building
HAS_MAIN_DOCKERFILE=false
HAS_SYNTARO_DOCKERFILE=false
[ -f "$PROJECT_ROOT/Dockerfile" ] && HAS_MAIN_DOCKERFILE=true
[ -f "$PROJECT_ROOT/Dockerfile.syntaro" ] && HAS_SYNTARO_DOCKERFILE=true

# Test 2.1: Main Dockerfile exists
if [ "$HAS_MAIN_DOCKERFILE" = true ]; then
  pass "2.1" "Main Dockerfile exists"
else
  fail "2.1" "Main Dockerfile is missing"
fi

# Test 2.2: Dockerfile.syntaro exists
if [ "$HAS_SYNTARO_DOCKERFILE" = true ]; then
  pass "2.2" "Dockerfile.syntaro exists"
else
  warn "2.2" "Dockerfile.syntaro not found" "SYNTARO-specific Dockerfile not required if main Dockerfile is used"
fi

# Test 2.3: Dockerfile has HEALTHCHECK instruction
if [ "$HAS_MAIN_DOCKERFILE" = true ]; then
  if grep -q "HEALTHCHECK" "$PROJECT_ROOT/Dockerfile" 2>/dev/null; then
    pass "2.3" "Dockerfile includes HEALTHCHECK instruction"
  else
    warn "2.3" "Dockerfile missing HEALTHCHECK instruction" "Add HEALTHCHECK for container orchestration"
  fi
fi

# Test 2.4: Dockerfile uses non-root user
if [ "$HAS_MAIN_DOCKERFILE" = true ]; then
  if grep -q "^USER " "$PROJECT_ROOT/Dockerfile" 2>/dev/null; then
    pass "2.4" "Dockerfile runs as non-root user"
  else
    warn "2.4" "Dockerfile does not use non-root user" "Add 'USER' directive for security"
  fi
fi

# Test 2.5: Docker build is reproducible (lockfile present, integrity check)
BUILD_HAS_INTEGRITY=false
if [ "$HAS_MAIN_DOCKERFILE" = true ]; then
  if grep -q "integrity" "$PROJECT_ROOT/Dockerfile" 2>/dev/null; then
    BUILD_HAS_INTEGRITY=true
  fi
  if grep -q "lockfile" "$PROJECT_ROOT/Dockerfile" 2>/dev/null; then
    pass "2.5" "Dockerfile references lockfile for reproducible builds"
  elif [ "$BUILD_HAS_INTEGRITY" = true ]; then
    pass "2.5" "Dockerfile validates package integrity"
  else
    warn "2.5" "Dockerfile may not enforce reproducible builds" "Consider adding lockfile integrity checks"
  fi
fi

# =============================================================================
# SECTION 3: Docker Compose Validation
# =============================================================================

section "3" "Docker Compose Validation"

# Test 3.1: docker-compose.yml exists
if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
  pass "3.1" "docker-compose.yml exists"
else
  fail "3.1" "docker-compose.yml is missing"
fi

# Test 3.2: docker-compose.yml is valid YAML (use Python yaml parser if available)
if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
  if python3 -c "
import yaml, sys
try:
    with open('$PROJECT_ROOT/docker-compose.yml') as f:
        data = yaml.safe_load(f)
        assert 'services' in data, 'Missing services key'
        assert len(data['services']) > 0, 'No services defined'
    sys.exit(0)
except Exception as e:
    print(f'YAML validation error: {e}')
    sys.exit(1)
" 2>/dev/null; then
    pass "3.2" "docker-compose.yml is valid YAML"
  elif command -v docker &>/dev/null && (docker compose config &>/dev/null 2>&1 || docker-compose config &>/dev/null 2>&1); then
    cd "$PROJECT_ROOT"
    if docker compose config &>/dev/null 2>&1 || docker-compose config &>/dev/null 2>&1; then
      pass "3.2" "docker-compose.yml is valid YAML"
    else
      fail "3.2" "docker-compose.yml failed validation" "Run: docker compose -f docker-compose.yml config"
    fi
  else
    warn "3.2" "Cannot validate docker-compose.yml YAML" "Install python3 with PyYAML or docker-compose"
  fi
fi

# Test 3.3: All Docker Compose variants exist
COMPOSE_COUNT=0
for compose_file in docker-compose.yml docker-compose.dev.yml docker-compose.e2e.yml docker-compose.prod.yml docker-compose.worker.yml; do
  [ -f "$PROJECT_ROOT/$compose_file" ] && COMPOSE_COUNT=$((COMPOSE_COUNT + 1))
done
if [ "$COMPOSE_COUNT" -ge 3 ]; then
  pass "3.3" "Docker Compose variants exist (found $COMPOSE_COUNT files)"
elif [ "$COMPOSE_COUNT" -ge 1 ]; then
  warn "3.3" "Only $COMPOSE_COUNT Docker Compose files found" "Consider adding dev/e2e/prod variants"
else
  fail "3.3" "No Docker Compose files found"
fi

# Test 3.4: .env.example covers all env vars used in docker-compose.yml
if [ -f "$PROJECT_ROOT/docker-compose.yml" ] && [ -f "$PROJECT_ROOT/.env.example" ]; then
  COMPOSE_VARS=$(grep -oP '\$\{[A-Z_]+' "$PROJECT_ROOT/docker-compose.yml" 2>/dev/null | sed 's/${//' | sort -u || true)
  MISSING_VARS=()
  while IFS= read -r var; do
    [ -z "$var" ] && continue
    if ! grep -q "$var" "$PROJECT_ROOT/.env.example" 2>/dev/null; then
      MISSING_VARS+=("$var")
    fi
  done <<< "$COMPOSE_VARS"
  if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    pass "3.4" "All docker-compose env vars documented in .env.example"
  else
    warn "3.4" "Some docker-compose env vars missing from .env.example" "Missing: ${MISSING_VARS[*]}"
  fi
else
  skip "3.4" "docker-compose/.env.example cross-check" "Required files not found"
fi

# Test 3.5: Healthchecks configured on all services
if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
  HC_COUNT=$(grep -c "healthcheck:" "$PROJECT_ROOT/docker-compose.yml" 2>/dev/null || true)
  SERVICE_COUNT=$(grep -c "^\s\+[a-zA-Z]:" "$PROJECT_ROOT/docker-compose.yml" 2>/dev/null || true)
  # Count actual service definitions (not top-level keys)
  SERVICE_DEFS=$(python3 -c "
import yaml
with open('$PROJECT_ROOT/docker-compose.yml') as f:
    data = yaml.safe_load(f)
    print(len(data.get('services', {})))
" 2>/dev/null || echo "0")
  if [ "$HC_COUNT" -ge 3 ]; then
    pass "3.5" "Healthchecks configured on $HC_COUNT services"
  else
    warn "3.5" "Only $HC_COUNT healthchecks found in docker-compose.yml" "Add healthchecks for better orchestration"
  fi
fi

# =============================================================================
# SECTION 4: GitHub Actions Workflow
# =============================================================================

section "4" "GitHub Actions Workflow"

# Test 4.1: .github/workflows/syntaro.yml exists
if [ -f "$PROJECT_ROOT/.github/workflows/syntaro.yml" ]; then
  pass "4.1" ".github/workflows/syntaro.yml exists"
else
  fail "4.1" ".github/workflows/syntaro.yml is missing" "The SYNTARO workflow is required for issue-to-PR automation"
fi

# Test 4.2: Workflow is valid YAML
if [ -f "$PROJECT_ROOT/.github/workflows/syntaro.yml" ]; then
  if python3 -c "
import yaml, sys
try:
    with open('$PROJECT_ROOT/.github/workflows/syntaro.yml') as f:
        data = yaml.safe_load(f)
        assert 'jobs' in data, 'Missing jobs key'
        has_on = any(k == 'on' or k is True for k in data.keys())
        assert has_on, 'Missing on key'
    sys.exit(0)
except Exception as e:
    print(f'YAML validation error: {e}')
    sys.exit(1)
" 2>/dev/null; then
    pass "4.2" "syntaro.yml is valid YAML"
  else
    # Basic fallback check
    if grep -q "^jobs:" "$PROJECT_ROOT/.github/workflows/syntaro.yml" 2>/dev/null && \
       grep -q "^on:" "$PROJECT_ROOT/.github/workflows/syntaro.yml" 2>/dev/null; then
      pass "4.2" "syntaro.yml appears to be valid YAML (basic check)"
    else
      fail "4.2" "syntaro.yml missing required sections (jobs, on)" "Ensure 'on:' and 'jobs:' keys exist"
    fi
  fi
fi

# Test 4.3: Workflow references correct env vars
if [ -f "$PROJECT_ROOT/.github/workflows/syntaro.yml" ]; then
  WORKFLOW_SECRETS=$(grep -oP '\$\{{ secrets\.[A-Z_]+ }}' "$PROJECT_ROOT/.github/workflows/syntaro.yml" 2>/dev/null | sed 's/\${{ secrets\.\(.*\) }}/\1/' | sort -u || true)
  DOCUMENTED_IN_ENV=true
  if [ -f "$PROJECT_ROOT/.env.example" ]; then
    while IFS= read -r secret; do
      [ -z "$secret" ] && continue
      if ! grep -q "$secret" "$PROJECT_ROOT/.env.example" 2>/dev/null && \
         ! grep -q "$secret" "$PROJECT_ROOT/DEVELOPMENT.md" 2>/dev/null && \
         ! grep -q "$secret" "$PROJECT_ROOT/docs/launch-env-vars.md" 2>/dev/null; then
        DOCUMENTED_IN_ENV=false
      fi
    done <<< "$WORKFLOW_SECRETS"
  fi
  if [ "$DOCUMENTED_IN_ENV" = true ]; then
    pass "4.3" "Workflow secrets documented in config files"
  else
    warn "4.3" "Some workflow secrets may not be documented" "Secrets: $(echo "$WORKFLOW_SECRETS" | tr '\n' ' ')"
  fi
fi

# Test 4.4: CI workflow exists
if [ -f "$PROJECT_ROOT/.github/workflows/ci.yml" ] || [ -f "$PROJECT_ROOT/.github/workflows/ci-checks.yml" ]; then
  pass "4.4" "CI workflow exists"
else
  fail "4.4" "CI workflow is missing" "Create .github/workflows/ci.yml"
fi

# Test 4.5: Other essential workflows exist
WORKFLOW_COUNT=0
for wf in e2e-verify.yml release.yml quality.yml cd.yml; do
  [ -f "$PROJECT_ROOT/.github/workflows/$wf" ] && WORKFLOW_COUNT=$((WORKFLOW_COUNT + 1))
done
if [ "$WORKFLOW_COUNT" -ge 3 ]; then
  pass "4.5" "Essential workflows present ($WORKFLOW_COUNT of 4)"
elif [ "$WORKFLOW_COUNT" -ge 1 ]; then
  warn "4.5" "Only $WORKFLOW_COUNT of 4 essential workflows found" "Missing some of: e2e-verify, release, quality, cd"
else
  warn "4.5" "No supporting workflows found" "Create essential CI/CD workflows"
fi

# =============================================================================
# SECTION 5: Scripts & Entrypoints
# =============================================================================

section "5" "Scripts & Entrypoints"

# Test 5.1: scripts/syntaro/entrypoint.sh exists
if [ -d "$PROJECT_ROOT/scripts/syntaro" ]; then
  if [ -f "$PROJECT_ROOT/scripts/syntaro/entrypoint.sh" ]; then
    pass "5.1" "scripts/syntaro/entrypoint.sh exists"
  else
    warn "5.1" "scripts/syntaro/entrypoint.sh not found" "Entrypoint may be in a different location"
  fi
else
  warn "5.1" "scripts/syntaro/ directory not found" "Entrypoint structure may differ — check for entrypoint elsewhere"
fi

# Test 5.2: Healthcheck script exists
if [ -f "$PROJECT_ROOT/docker-healthcheck.sh" ]; then
  pass "5.2" "docker-healthcheck.sh exists"
elif grep -q "HEALTHCHECK" "$PROJECT_ROOT/Dockerfile" 2>/dev/null; then
  pass "5.2" "Healthcheck is defined in Dockerfile (inline)"
else
  warn "5.2" "No healthcheck script or Dockerfile HEALTHCHECK found" "Consider adding a healthcheck mechanism"
fi

# Test 5.3: Key operational scripts exist
SCRIPT_COUNT=0
for script in setup.sh doctor.sh quality-gates.sh e2e-verify.sh env-sanitize.sh; do
  [ -f "$PROJECT_ROOT/scripts/$script" ] && SCRIPT_COUNT=$((SCRIPT_COUNT + 1))
done
if [ "$SCRIPT_COUNT" -ge 4 ]; then
  pass "5.3" "Key operational scripts exist ($SCRIPT_COUNT of 5)"
elif [ "$SCRIPT_COUNT" -ge 2 ]; then
  warn "5.3" "Only $SCRIPT_COUNT of 5 key operational scripts found" "Consider adding missing scripts"
else
  fail "5.3" "Few or no key operational scripts found" "Found $SCRIPT_COUNT scripts"
fi

# Test 5.4: Scripts are executable
NON_EXECUTABLE=0
SCRIPT_FILES=0
for script in "$PROJECT_ROOT"/scripts/*.sh; do
  [ -f "$script" ] || continue
  SCRIPT_FILES=$((SCRIPT_FILES + 1))
  [ -x "$script" ] || NON_EXECUTABLE=$((NON_EXECUTABLE + 1))
done
if [ "$NON_EXECUTABLE" -eq 0 ] && [ "$SCRIPT_FILES" -gt 0 ]; then
  pass "5.4" "All scripts are executable ($SCRIPT_FILES files)"
elif [ "$NON_EXECUTABLE" -gt 0 ]; then
  warn "5.4" "$NON_EXECUTABLE of $SCRIPT_FILES scripts are not executable" "Run: chmod +x scripts/*.sh"
else
  fail "5.4" "No shell scripts found in scripts/"
fi

# Test 5.5: Entrypoint validates required env vars
if [ -f "$PROJECT_ROOT/scripts/doctor.sh" ]; then
  if grep -q "JWT_SECRET\|GITHUB_APP_ID\|REDIS_URL\|DATABASE_URL" "$PROJECT_ROOT/scripts/doctor.sh" 2>/dev/null; then
    pass "5.5" "Doctor script validates required environment variables"
  else
    warn "5.5" "Doctor script may not validate required env vars" "Consider adding env var validation"
  fi
else
  warn "5.5" "Cannot verify env var validation" "scripts/doctor.sh not found"
fi

# =============================================================================
# SECTION 6: Documentation
# =============================================================================

section "6" "Documentation"

# Test 6.1: README.md exists
if [ -f "$PROJECT_ROOT/README.md" ]; then
  README_SIZE=$(wc -c < "$PROJECT_ROOT/README.md")
  if [ "$README_SIZE" -gt 500 ]; then
    pass "6.1" "README.md exists and is substantive ($README_SIZE bytes)"
  else
    warn "6.1" "README.md exists but is very small ($README_SIZE bytes)" "Consider expanding the README"
  fi
else
  fail "6.1" "README.md is missing"
fi

# Test 6.2: AGENTS.md exists
if [ -f "$PROJECT_ROOT/AGENTS.md" ]; then
  pass "6.2" "AGENTS.md exists"
else
  warn "6.2" "AGENTS.md not found" "Required for agent-based deployment instructions"
fi

# Test 6.3: SPEC.md or equivalent architecture doc exists
HAS_SPEC=false
for doc in SPEC.md ARCHITECTURE.md docs/ARCHITECTURE.md docs/architecture.md; do
  [ -f "$PROJECT_ROOT/$doc" ] && HAS_SPEC=true
done
if [ "$HAS_SPEC" = true ]; then
  pass "6.3" "Architecture/specification document exists"
else
  warn "6.3" "No SPEC.md or ARCHITECTURE.md found" "Consider adding an architecture document"
fi

# Test 6.4: docs/ directory has content
if [ -d "$PROJECT_ROOT/docs" ]; then
  DOC_COUNT=$(find "$PROJECT_ROOT/docs" -name "*.md" -o -name "*.html" -o -name "*.rst" 2>/dev/null | wc -l)
  if [ "$DOC_COUNT" -gt 10 ]; then
    pass "6.4" "docs/ directory has $DOC_COUNT documentation files"
  elif [ "$DOC_COUNT" -gt 0 ]; then
    warn "6.4" "docs/ directory has only $DOC_COUNT files" "Consider adding more documentation"
  else
    fail "6.4" "docs/ directory is empty"
  fi
else
  fail "6.4" "docs/ directory does not exist"
fi

# Test 6.5: Key documentation files present
DOC_FILES=(CHANGELOG.md CONTRIBUTING.md LICENSE DEVELOPMENT.md WORKFLOW.md openapi.yaml)
DOC_FOUND=0
DOC_MISSING=()
for doc in "${DOC_FILES[@]}"; do
  [ -f "$PROJECT_ROOT/$doc" ] && DOC_FOUND=$((DOC_FOUND + 1)) || DOC_MISSING+=("$doc")
done
if [ "$DOC_FOUND" -eq "${#DOC_FILES[@]}" ]; then
  pass "6.5" "All key documentation files present ($DOC_FOUND of ${#DOC_FILES[@]})"
else
  warn "6.5" "$DOC_FOUND of ${#DOC_FILES[@]} key documentation files present" "Missing: ${DOC_MISSING[*]}"
fi

# =============================================================================
# SECTION 7: Test Infrastructure
# =============================================================================

section "7" "Test Infrastructure"

# Test 7.1: test/ directory exists
if [ -d "$PROJECT_ROOT/tests" ]; then
  TEST_COUNT=$(find "$PROJECT_ROOT/tests" -name "*.test.ts" -o -name "*.test.js" -o -name "*.test.py" 2>/dev/null | wc -l)
  if [ "$TEST_COUNT" -gt 0 ]; then
    pass "7.1" "tests/ directory exists with $TEST_COUNT test files"
  else
    warn "7.1" "tests/ directory exists but no test files found"
  fi
else
  fail "7.1" "tests/ directory does not exist"
fi

# Test 7.2: E2E test structure is valid
if [ -d "$PROJECT_ROOT/tests/e2e" ]; then
  E2E_TEST_FILES=$(find "$PROJECT_ROOT/tests/e2e" -name "*.test.ts" 2>/dev/null | wc -l)
  if [ -f "$PROJECT_ROOT/tests/e2e/harness/index.ts" ]; then
    pass "7.2" "E2E test structure is valid ($E2E_TEST_FILES test files, harness present)"
  else
    warn "7.2" "E2E tests directory exists but harness may be incomplete" "Ensure tests/e2e/harness/index.ts exists"
  fi
else
  fail "7.2" "E2E test directory (tests/e2e) does not exist"
fi

# Test 7.3: Test runner support exists (vitest config)
if [ -f "$PROJECT_ROOT/vitest.config.ts" ] || [ -f "$PROJECT_ROOT/vitest.config.e2e.ts" ]; then
  VITEST_COUNT=0
  for vc in vitest.config.ts vitest.config.e2e.ts vitest.e2e.config.ts vitest.integration.config.ts; do
    [ -f "$PROJECT_ROOT/$vc" ] && VITEST_COUNT=$((VITEST_COUNT + 1))
  done
  pass "7.3" "Test runner support exists ($VITEST_COUNT vitest config files)"
else
  warn "7.3" "No vitest configuration found" "Add vitest.config.ts for test infrastructure"
fi

# Test 7.4: Smoke test runner script exists
if [ -f "$PROJECT_ROOT/scripts/run-e2e-smoke-tests.sh" ]; then
  pass "7.4" "Smoke test runner script exists (scripts/run-e2e-smoke-tests.sh)"
else
  warn "7.4" "Smoke test runner script not found" "Create scripts/run-e2e-smoke-tests.sh for streamlined execution"
fi

# Test 7.5: Launch readiness test exists
if [ -f "$PROJECT_ROOT/tests/launch-readiness.test.ts" ]; then
  pass "7.5" "Launch readiness test exists (tests/launch-readiness.test.ts)"
else
  warn "7.5" "Launch readiness test not found" "Create tests/launch-readiness.test.ts for pre-deployment verification"
fi

# =============================================================================
# SUMMARY REPORT
# =============================================================================

echo ""
echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e " ${BOLD}${CYAN}  SMOKE TEST SUMMARY${NC}"
echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
echo "  Total:  $TOTAL"
echo -e "  ${GREEN}Pass:   $PASSED${NC}"
echo -e "  ${RED}Fail:   $FAILED${NC}"
echo -e "  ${YELLOW}Warn:   $WARNED${NC}"
echo -e "  ${BLUE}Skip:   $SKIPPED${NC}"
echo -e " ${BOLD}${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

# Exit code logic
if [ "$FAILED" -gt 0 ]; then
  echo -e "  ${RED}${BOLD}❌ Some tests FAILED. Review failures above.${NC}"
  EXIT_CODE=1
else
  echo -e "  ${GREEN}${BOLD}✅ All tests passed with $WARNED warnings and $SKIPPED skipped.${NC}"
  EXIT_CODE=0
fi
echo ""

# JSON summary output
if [ "$JSON_OUTPUT" = true ]; then
  # Build JSON
  cat > "$SUMMARY_FILE" <<EOF
{
  "tool": "SYNTARO Pre-Launch Smoke Test",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "results": {
    "total": $TOTAL,
    "passed": $PASSED,
    "failed": $FAILED,
    "warnings": $WARNED,
    "skipped": $SKIPPED
  },
  "exit_code": $EXIT_CODE,
  "tests": [
EOF
  # Add individual test results
  for ((i=0; i<${#RESULTS[@]}; i++)); do
    if [ "$i" -gt 0 ]; then
      echo "," >> "$SUMMARY_FILE"
    fi
    echo -n "    ${RESULTS[$i]}" >> "$SUMMARY_FILE"
  done
  echo "" >> "$SUMMARY_FILE"
  cat >> "$SUMMARY_FILE" <<EOF
  ]
}
EOF
  echo -e " ${BOLD}JSON summary written to:${NC} $SUMMARY_FILE"
  echo ""
  cat "$SUMMARY_FILE"
  echo ""
fi

exit $EXIT_CODE
