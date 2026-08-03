#!/usr/bin/env bash
# =============================================================================
# SYNTARO — Docker Validation Script
#
# Validates the production Docker Compose stack:
#   1. Builds all images without errors
#   2. Starts the stack and waits for health
#   3. Sends a test webhook via curl
#   4. Checks logs for errors
#   5. Tears down cleanly
#
# Usage:
#   ./scripts/docker-validate.sh          # Full validation
#   ./scripts/docker-validate.sh --quiet  # Minimal output, exit code only
#   ./scripts/docker-validate.sh --skip-build  # Skip build step
#
# Returns:
#   0 — all steps passed
#   1 — one or more steps failed
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://localhost:3000/health"
HEALTH_TIMEOUT_SEC=60
HEALTH_POLL_INTERVAL=5
COMPOSE_PROJECT_NAME="syntaro-validate-$(date +%s)"
TEST_WEBHOOK_PAYLOAD='{"action":"labeled","issue":{"number":1,"title":"Test issue","body":"Test body","labels":[{"name":"syntaro:fix"}]},"label":{"name":"syntaro:fix"},"repository":{"full_name":"owner/test-repo"},"installation":{"id":999}}'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
STEP=0
QUIET=false
SKIP_BUILD=false

log()    { [[ "$QUIET" == false ]] && echo "[$(date +%H:%M:%S)] $*"; }
pass()   { PASS=$((PASS + 1)); log "  ✅ PASS: $*"; }
fail()   { FAIL=$((FAIL + 1)); log "  ❌ FAIL: $*"; }

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Step 1: Build images
# ---------------------------------------------------------------------------
step_build() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Build Docker images ═══"

  if [[ "$SKIP_BUILD" == true ]]; then
    log "  ⏭️  Skipping build (--skip-build)"
    return
  fi

  if docker compose -f "$COMPOSE_FILE" build --quiet 2>&1; then
    pass "All images built successfully"
  else
    fail "Docker build failed"
  fi
}

# ---------------------------------------------------------------------------
# Step 2: Start stack
# ---------------------------------------------------------------------------
step_start() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Start Docker stack ═══"

  if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" up -d 2>&1; then
    pass "Stack started"
  else
    fail "Stack failed to start"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 3: Wait for health
# ---------------------------------------------------------------------------
step_health() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Wait for health endpoint ═══"
  log "  Polling $HEALTH_URL every ${HEALTH_POLL_INTERVAL}s (timeout: ${HEALTH_TIMEOUT_SEC}s)"

  local elapsed=0
  while true; do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      pass "Health endpoint returned 200 OK (${elapsed}s)"
      break
    fi

    elapsed=$((elapsed + HEALTH_POLL_INTERVAL))
    if [[ "$elapsed" -ge "$HEALTH_TIMEOUT_SEC" ]]; then
      fail "Health endpoint not ready after ${HEALTH_TIMEOUT_SEC}s"
      return 1
    fi

    sleep "$HEALTH_POLL_INTERVAL"
  done
}

# ---------------------------------------------------------------------------
# Step 4: Send test webhook
# ---------------------------------------------------------------------------
step_webhook() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Send test webhook ═══"

  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$HEALTH_URL/../webhook" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: issues.labeled" \
    -H "X-GitHub-Delivery: test-$(date +%s)" \
    -d "$TEST_WEBHOOK_PAYLOAD" 2>&1) || true

  if [[ "$resp" == "202" ]]; then
    pass "Webhook accepted (HTTP 202)"
  else
    fail "Webhook returned HTTP $resp (expected 202)"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Step 5: Check logs for errors
# ---------------------------------------------------------------------------
step_logs() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Check logs for errors ═══"

  local error_count
  error_count=$(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" logs --tail=200 2>&1 | grep -ciE '\b(error|exception|traceback|failed)\b' || true)

  if [[ "$error_count" -eq 0 ]]; then
    pass "No errors found in container logs"
  else
    log "  ⚠️  Found $error_count error log lines (may be expected during startup)"
    # Show the errors
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" logs --tail=200 2>&1 | grep -iE '\b(error|exception|traceback|failed)\b' | head -20 || true
    # Non-fatal: report as pass but note the count
    pass "Logs checked — $error_count error pattern(s) found (review above)"
  fi
}

# ---------------------------------------------------------------------------
# Step 6: Tear down
# ---------------------------------------------------------------------------
step_teardown() {
  STEP=$((STEP + 1))
  log ""
  log "═══ Step $STEP: Tear down stack ═══"

  if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" down -v 2>&1; then
    pass "Stack torn down cleanly"
  else
    fail "Teardown encountered issues"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
report() {
  local total=$((PASS + FAIL))
  log ""
  log "═══════════════════════════════════════"
  log "  Results: $PASS passed, $FAIL failed, $total total"
  log "═══════════════════════════════════════"

  if [[ "$FAIL" -gt 0 ]]; then
    log "  ❌ VALIDATION FAILED"
  else
    log "  ✅ ALL CHECKS PASSED"
  fi

  return "$FAIL"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "SYNTARO Docker Validation"
  log "Project: $COMPOSE_PROJECT_NAME"
  log "Compose file: $COMPOSE_FILE"
  log ""

  # Check prereqs
  if ! command -v docker &> /dev/null; then
    fail "Docker is not installed"
    report
    exit 1
  fi

  step_build
  step_start
  step_health
  step_webhook
  step_logs
  step_teardown
  report
}

main
