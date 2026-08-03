#!/usr/bin/env bash
# =============================================================================
# AIM-3210: E2E Smoke Test Runner
#
# Runs the comprehensive E2E smoke test suite for SYNTARO launch verification.
# This script handles Docker service setup, test execution, and cleanup.
#
# Usage:
#   ./scripts/run-e2e-smoke-tests.sh            # Run all smoke tests
#   ./scripts/run-e2e-smoke-tests.sh --verbose   # Run with verbose output
#   ./scripts/run-e2e-smoke-tests.sh --watch     # Run in watch mode
#   ./scripts/run-e2e-smoke-tests.sh --list      # List available smoke tests
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
#   2 - Infrastructure setup failed
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

E2E_CONFIG="${PROJECT_ROOT}/vitest.e2e.config.ts"
SMOKE_TESTS_DIR="${PROJECT_ROOT}/tests/e2e"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.e2e.yml"

# Smoke test files (AIM-3210)
SMOKE_TESTS=(
  "happy-path.test.ts"
  "ai-disabled-path.test.ts"
  "error-handling-path.test.ts"
  "auth-path.test.ts"
  "rate-limit-path.test.ts"
  "queue-depth-path.test.ts"
  "health-check-path.test.ts"
  "dlq-path.test.ts"
  "verification-gates.test.ts"
)

VERBOSE=false
WATCH=false
LIST_ONLY=false
EXIT_CODE=0

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[FAIL]${NC} $1"
}

# Print banner
print_banner() {
  echo ""
  echo "=============================================="
  echo "  SYNTARO E2E Smoke Test Runner"
  echo "  AIM-3210: Launch Verification"
  echo "=============================================="
  echo ""
}

# Check prerequisites
check_prerequisites() {
  log_info "Checking prerequisites..."

  # Check Node.js
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    return 1
  fi
  log_success "Node.js $(node -v)"

  # Check npm
  if ! command -v npm &> /dev/null; then
    log_error "npm is not installed"
    return 1
  fi
  log_success "npm $(npm -v)"

  # Check Docker
  if ! command -v docker &> /dev/null; then
    log_warning "Docker is not installed — E2E tests requiring Redis will be skipped"
  else
    log_success "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
  fi

  # Check dependencies
  if [ ! -d "${PROJECT_ROOT}/node_modules" ]; then
    log_info "Installing dependencies..."
    (cd "$PROJECT_ROOT" && npm ci)
    log_success "Dependencies installed"
  fi

  return 0
}

# Start Docker services
start_docker_services() {
  log_info "Starting Docker services (Redis)..."
  (cd "$PROJECT_ROOT" && docker compose -f "$DOCKER_COMPOSE_FILE" up -d redis 2>/dev/null) || {
    log_warning "Failed to start Docker services — tests requiring Redis may fail"
    return 1
  }

  # Wait for Redis
  log_info "Waiting for Redis to be ready..."
  for i in $(seq 1 15); do
    if docker exec syntaro-e2e-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
      log_success "Redis is ready"
      return 0
    fi
    sleep 1
  done

  log_warning "Redis did not become ready in time"
  return 1
}

# Stop Docker services
stop_docker_services() {
  log_info "Stopping Docker services..."
  (cd "$PROJECT_ROOT" && docker compose -f "$DOCKER_COMPOSE_FILE" down --remove-orphans 2>/dev/null) || true
  log_success "Docker services stopped"
}

# List available smoke tests
list_tests() {
  echo ""
  echo "Available Smoke Tests (AIM-3210):"
  echo "--------------------------------"
  for test in "${SMOKE_TESTS[@]}"; do
    if [ -f "${SMOKE_TESTS_DIR}/${test}" ]; then
      echo "  ✓ ${test}"
    else
      echo "  ✗ ${test} (not found)"
    fi
  done
  echo ""
}

# Run smoke tests
run_smoke_tests() {
  local npx_args=("vitest" "run" "--config" "$E2E_CONFIG")

  if [ "$VERBOSE" = true ]; then
    npx_args+=("--reporter=verbose")
  fi

  # If --test specified, run that specific test
  if [ -n "${SINGLE_TEST:-}" ]; then
    npx_args+=("${SMOKE_TESTS_DIR}/${SINGLE_TEST}")
    log_info "Running single test: ${SINGLE_TEST}"
  fi

  log_info "Running E2E smoke tests..."
  echo ""

  (cd "$PROJECT_ROOT" && npx "${npx_args[@]}")
  local result=$?

  if [ $result -eq 0 ]; then
    echo ""
    log_success "All smoke tests passed!"
  else
    echo ""
    log_error "Some smoke tests failed (exit code: $result)"
  fi

  return $result
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  print_banner

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --verbose|-v)
        VERBOSE=true
        shift
        ;;
      --watch|-w)
        WATCH=true
        shift
        ;;
      --list|-l)
        LIST_ONLY=true
        shift
        ;;
      --test|-t)
        SINGLE_TEST="$2"
        shift 2
        ;;
      --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --verbose, -v    Verbose output"
        echo "  --watch, -w      Watch mode (re-run on changes)"
        echo "  --list, -l       List available smoke tests"
        echo "  --test NAME, -t  Run a specific test file"
        echo "  --help, -h       Show this help"
        exit 0
        ;;
      *)
        log_error "Unknown option: $1"
        exit 1
        ;;
    esac
  done

  # List mode
  if [ "$LIST_ONLY" = true ]; then
    list_tests
    exit 0
  fi

  # Check prerequisites
  check_prerequisites || {
    log_error "Prerequisites check failed"
    exit 2
  }

  # Check if smoke test files exist
  for test in "${SMOKE_TESTS[@]}"; do
    if [ ! -f "${SMOKE_TESTS_DIR}/${test}" ]; then
      log_warning "Smoke test file not found: ${test}"
    fi
  done

  # Start Docker services
  start_docker_services || {
    log_warning "Continuing without Docker services..."
  }

  # Run tests
  if [ "$WATCH" = true ]; then
    log_info "Starting in watch mode..."
    (cd "$PROJECT_ROOT" && npx vitest --config "$E2E_CONFIG" --watch)
    EXIT_CODE=$?
  else
    run_smoke_tests
    EXIT_CODE=$?
  fi

  # Cleanup
  stop_docker_services

  exit $EXIT_CODE
}

main "$@"
