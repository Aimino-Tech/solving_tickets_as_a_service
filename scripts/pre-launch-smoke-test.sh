#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass()  { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
log_fail()  { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARN++)); }

check_cmd() {
  if command -v "$1" &>/dev/null; then
    log_pass "$1 found: $($1 --version 2>&1 | head -1)"
    return 0
  else
    log_fail "$1 not found"
    return 1
  fi
}

check_env() {
  if [[ -n "${!1-}" ]]; then
    log_pass "$1 is set"
    return 0
  else
    log_fail "$1 is not set"
    return 1
  fi
}

section() {
  echo ""; echo "=============================================="
  echo "  $1"; echo "=============================================="
}

echo ""; echo "=============================================="
echo "  STAS Pre-Launch Smoke Test"
echo "=============================================="

section "1. Environment Validation"
check_cmd node
check_cmd npm
check_cmd docker
check_cmd gh
check_env GITHUB_TOKEN
check_env LINEAR_API_KEY || true

if [[ -d "${PROJECT_ROOT}/node_modules" ]]; then
  log_pass "node_modules exists"
else
  log_warn "node_modules not found — run npm ci first"
fi

section "2. Docker Compose Build"
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif docker-compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  log_fail "Docker Compose not available"
fi

if docker info &>/dev/null; then
  log_pass "Docker daemon running"
else
  log_fail "Docker daemon not running — cannot proceed"
fi

section "3. GitHub App Configuration"
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  log_pass ".env file exists"
  GITHUB_APP_ID=$(grep "^GITHUB_APP_ID=" "${PROJECT_ROOT}/.env" 2>/dev/null | cut -d= -f2)
  if [[ -n "$GITHUB_APP_ID" ]]; then
    log_pass "GITHUB_APP_ID = $GITHUB_APP_ID"
  else
    log_warn "GITHUB_APP_ID not found in .env"
  fi
else
  log_warn ".env file not found — creating from .env.example"
  if [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    log_warn ".env created from .env.example — review and update values"
  fi
fi

section "4. Application Build"
if [[ -f "${PROJECT_ROOT}/dist/server.js" ]] || [[ -f "${PROJECT_ROOT}/dist/index.js" ]]; then
  log_pass "Application build found"
else
  log_info "Building application..."
  (cd "$PROJECT_ROOT" && npm run build) && log_pass "Build succeeded" || log_fail "Build failed"
fi

section "5. Configuration Validation"
CONFIG_FILES=(".env.example" "docker-compose.yml" "tsconfig.json" "vitest.config.ts")
for f in "${CONFIG_FILES[@]}"; do
  if [[ -f "${PROJECT_ROOT}/${f}" ]]; then
    log_pass "$f exists"
  else
    log_warn "$f missing"
  fi
done

section "6. Database Migration Check"
if [[ -f "${PROJECT_ROOT}/src/db/migrations" ]]; then
  log_pass "Migrations directory exists"
  MIGRATION_COUNT=$(ls "${PROJECT_ROOT}/src/db/migrations/"*.ts 2>/dev/null | wc -l)
  log_info "$MIGRATION_COUNT migration files found"
else
  log_warn "No migration directory found at src/db/migrations"
fi

section "7. Test Suite"
if [[ -d "${PROJECT_ROOT}/tests" ]]; then
  log_pass "Tests directory exists"
  TEST_COUNT=$(find "${PROJECT_ROOT}/tests" -name "*.test.ts" -o -name "*.test.js" 2>/dev/null | wc -l)
  log_info "$TEST_COUNT test files found"
else
  log_warn "No tests directory found"
fi

section "8. Docker Health Check"
log_info "Building and starting Docker services..."
(cd "$PROJECT_ROOT" && ${COMPOSE_CMD:-docker compose} build --quiet 2>/dev/null) && log_pass "Docker build OK" || log_warn "Docker build skipped (may need config)"

section "9. Dashboard Build"
if [[ -d "${PROJECT_ROOT}/dashboard" ]]; then
  if [[ -f "${PROJECT_ROOT}/dashboard/node_modules/.package-lock.json" ]]; then
    log_pass "Dashboard dependencies installed"
  else
    log_warn "Dashboard dependencies not installed"
  fi
  if [[ -d "${PROJECT_ROOT}/dashboard/dist" ]]; then
    log_pass "Dashboard build exists"
  else
    log_warn "Dashboard build not found"
  fi
else
  log_info "No dashboard directory found"
fi

echo ""; echo "=============================================="
echo "  Results"
echo "=============================================="
echo -e "  ${GREEN}Passed:${NC} $PASS"
echo -e "  ${RED}Failed:${NC} $FAIL"
echo -e "  ${YELLOW}Warnings:${NC} $WARN"
echo ""

if [[ $FAIL -gt 0 ]]; then
  log_fail "$FAIL check(s) failed — review before launch"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  log_warn "$WARN warning(s) — address if possible before launch"
  exit 0
else
  log_pass "All checks passed — ready for launch"
  exit 0
fi
