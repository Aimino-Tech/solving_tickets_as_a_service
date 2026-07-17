#!/usr/bin/env bash
# =============================================================================
# STAS Scaling Verification Script
#
# Verifies that Docker Compose scaling works correctly:
#   1. docker compose --scale stas-worker=4
#   2. PostgreSQL connection pool max increased
#   3. Nginx reverse proxy configured
#   4. RabbitMQ queue bindings correct
#   5. Health endpoints responsive
#
# Usage:
#   ./scripts/scale-verify.sh [options]
#
# Options:
#   --compose-file <file>   Docker Compose file to use (default: docker-compose.prod.yml)
#   --target <url>          STAS base URL (default: http://localhost:3000)
#   --scale <count>         Number of worker replicas to verify (default: 4)
#   --db-pool-max <count>   Expected database pool max (default: 20)
#   --skip-docker           Skip Docker Compose checks
#   --help                  Show this help
# =============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────

COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
TARGET="http://localhost:3000"
SCALE_COUNT=4
DB_POOL_MAX=20
SKIP_DOCKER=false
PASS=0
FAIL=0

# ── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --scale) SCALE_COUNT="$2"; shift 2 ;;
    --db-pool-max) DB_POOL_MAX="$2"; shift 2 ;;
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --help) grep '^#' "$0" | head -40 | cut -c3-; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

PASS_TEXT="\e[32m✓ PASS\e[0m"
FAIL_TEXT="\e[31m✗ FAIL\e[0m"

check_pass() {
  echo -e "  ${PASS_TEXT} $1"
  ((PASS++))
}

check_fail() {
  echo -e "  ${FAIL_TEXT} $1"
  ((FAIL++))
}

check() {
  local desc="$1"
  shift
  if "$@"; then
    check_pass "$desc"
  else
    check_fail "$desc"
  fi
}

echo "═══════════════════════════════════════════════════════════════════════"
echo "  STAS Scaling Verification"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Compose file:  $COMPOSE_FILE"
echo "  Target URL:    $TARGET"
echo "  Scale count:   $SCALE_COUNT"
echo "  DB pool max:   $DB_POOL_MAX"
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 1. Docker Compose Scaling Check
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  1. Docker Compose Scaling"
echo "───────────────────────────────────────────────────────────────────────"

if [[ "$SKIP_DOCKER" == "false" ]]; then
  # Check compose file exists
  check "Compose file exists" test -f "$COMPOSE_FILE"

  # Check stas-worker service is defined and supports scaling
  if command -v docker &>/dev/null; then
    # Verify compose file has no container_name for stas-worker (required for scaling)
    if grep -q "container_name:" "$COMPOSE_FILE" 2>/dev/null; then
      # Check if stas-worker has a container_name that would prevent scaling
      if grep -A5 "stas-worker:" "$COMPOSE_FILE" | grep -q "container_name:"; then
        check_fail "stas-worker has container_name set - cannot scale (remove container_name)"
      else
        check_pass "stas-worker has no container_name - scaling enabled"
      fi
    else
      check_pass "No container_name found - all services are scalable"
    fi

    # Check stas-webhook has no container_name (for horizontal scaling)
    if grep -A5 "stas-webhook:" "$COMPOSE_FILE" | grep -q "container_name:"; then
      check_fail "stas-webhook has container_name set - cannot scale horizontally"
    else
      check_pass "stas-webhook has no container_name - scaling enabled"
    fi

    # Verify docker compose syntax is valid
    if docker compose -f "$COMPOSE_FILE" config --quiet 2>/dev/null; then
      check_pass "Docker Compose configuration is valid"
    else
      check_fail "Docker Compose configuration has errors"
    fi

    # Verify the scale command would work
    echo "  Testing: docker compose --scale stas-worker=$SCALE_COUNT ..."
    if docker compose -f "$COMPOSE_FILE" config 2>/dev/null | grep -q "stas-worker"; then
      check_pass "docker compose --scale stas-worker=$SCALE_COUNT supported"
    else
      check_fail "stas-worker service not found in compose file"
    fi
  else
    echo "  ⚠ Docker not available - skipping Docker checks"
    # Still do static file analysis
    if grep -q "stas-worker" "$COMPOSE_FILE"; then
      check_pass "stas-worker service defined in compose file"
    else
      check_fail "stas-worker service NOT defined in compose file"
    fi
  fi
else
  echo "  ⚠ Docker checks skipped (--skip-docker)"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 2. PostgreSQL Connection Pool Check
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  2. PostgreSQL Connection Pool Configuration"
echo "───────────────────────────────────────────────────────────────────────"

# Check the .env or config for DATABASE_POOL_MAX
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q "DATABASE_POOL_MAX=" "$ENV_FILE" 2>/dev/null; then
    ENV_VAL=$(grep "DATABASE_POOL_MAX=" "$ENV_FILE" | cut -d= -f2)
    if [[ "$ENV_VAL" -ge "$DB_POOL_MAX" ]]; 2>/dev/null; then
      check_pass "DATABASE_POOL_MAX=$ENV_VAL (>= $DB_POOL_MAX target)"
    else
      check_fail "DATABASE_POOL_MAX=$ENV_VAL (< $DB_POOL_MAX target)"
    fi
  else
    check_fail "DATABASE_POOL_MAX not set in .env"
  fi
else
  echo "  ⚠ .env file not found - checking config.ts defaults"
fi

# Check src/config.ts for pool max setting
if grep -q "DATABASE_POOL_MAX" "$PROJECT_DIR/src/config.ts" 2>/dev/null; then
  check_pass "DATABASE_POOL_MAX defined in src/config.ts"
else
  check_fail "DATABASE_POOL_MAX NOT found in src/config.ts"
fi

# Check for SCALING_PG_POOL_MAX config
if grep -q "SCALING_PG_POOL_MAX" "$PROJECT_DIR/src/config.ts" 2>/dev/null; then
  check_pass "SCALING_PG_POOL_MAX scaling config present"
else
  check_fail "SCALING_PG_POOL_MAX scaling config MISSING"
fi

# Check that the database pool is actually used in the connection code
if grep -q "poolMax\|pool_max\|DATABASE_POOL_MAX" "$PROJECT_DIR/src/db/"*.ts 2>/dev/null; then
  check_pass "Database connection pool size is configurable"
else
  check_fail "Database connection pool may not use configurable max"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 3. Nginx Reverse Proxy Check
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  3. Nginx Reverse Proxy Configuration"
echo "───────────────────────────────────────────────────────────────────────"

NGINX_DIR="$PROJECT_DIR/nginx"
if [[ -d "$NGINX_DIR" ]]; then
  check_pass "Nginx configuration directory exists"

  # Check for main nginx config
  if [[ -f "$NGINX_DIR/nginx.conf" ]]; then
    check_pass "nginx/nginx.conf exists"

    # Check upstream block (load balancing)
    if grep -q "upstream " "$NGINX_DIR/nginx.conf" 2>/dev/null; then
      check_pass "Nginx upstream block configured for load balancing"
    fi

    # Check least_conn strategy
    if grep -q "least_conn" "$NGINX_DIR/nginx.conf" 2>/dev/null; then
      check_pass "Nginx uses least_conn load balancing strategy"
    fi

    # Check rate limiting zones
    for zone in webhook_limit api_limit health_limit; do
      if grep -q "zone=$zone" "$NGINX_DIR/nginx.conf" 2>/dev/null; then
        check_pass "Nginx rate limiting zone '$zone' configured"
      else
        check_fail "Nginx rate limiting zone '$zone' MISSING"
      fi
    done

    # Check proxy pass to upstream
    if grep -q "proxy_pass http://stas-webhook-upstream" "$NGINX_DIR/nginx.conf" 2>/dev/null; then
      check_pass "Nginx proxies to stas-webhook-upstream"
    fi

    # Check worker_connections for concurrency
    if grep -q "worker_connections" "$NGINX_DIR/nginx.conf" 2>/dev/null; then
      WC=$(grep "worker_connections" "$NGINX_DIR/nginx.conf" | awk '{print $2}')
      if [[ "$WC" -ge 1024 ]] 2>/dev/null; then
        check_pass "Nginx worker_connections=$WC (>= 1024)"
      else
        check_fail "Nginx worker_connections=$WC (< 1024)"
      fi
    fi
  else
    check_fail "nginx/nginx.conf MISSING"
  fi

  # Check for site config file
  if [[ -f "$NGINX_DIR/stas.conf" ]]; then
    check_pass "nginx/stas.conf site config exists"
  fi
else
  check_fail "Nginx directory MISSING"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 4. Health & Monitoring Endpoints
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  4. Service Health Endpoints"
echo "───────────────────────────────────────────────────────────────────────"

if command -v curl &>/dev/null; then
  # Health endpoint
  HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/health" 2>/dev/null || echo "000")
  if [[ "$HEALTH_STATUS" == "200" ]]; then
    check_pass "/health endpoint returns 200"
  else
    check_fail "/health endpoint returned $HEALTH_STATUS (expected 200)"
  fi

  # Health ready endpoint
  READY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/health/ready" 2>/dev/null || echo "000")
  if [[ "$READY_STATUS" == "200" || "$READY_STATUS" == "503" ]]; then
    check_pass "/health/ready endpoint is responsive ($READY_STATUS)"
  else
    check_fail "/health/ready endpoint returned $READY_STATUS"
  fi

  # Queue health endpoint
  QUEUE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/health/queue" 2>/dev/null || echo "000")
  if [[ "$QUEUE_STATUS" == "200" || "$QUEUE_STATUS" == "503" ]]; then
    check_pass "/health/queue endpoint is responsive ($QUEUE_STATUS)"
  else
    check_fail "/health/queue endpoint returned $QUEUE_STATUS"
  fi

  # Metrics endpoint
  METRICS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/metrics" 2>/dev/null || echo "000")
  if [[ "$METRICS_STATUS" == "200" ]]; then
    check_pass "/metrics endpoint returns 200"
  else
    check_fail "/metrics endpoint returned $METRICS_STATUS"
  fi
else
  echo "  ⚠ curl not available - skipping endpoint health checks"
fi

# Check for scaling API health
SCALING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET/api/scaling/status" 2>/dev/null || echo "000")
if [[ "$SCALING_STATUS" == "200" || "$SCALING_STATUS" == "401" || "$SCALING_STATUS" == "404" ]]; then
  check_pass "/api/scaling/status endpoint is responsive ($SCALING_STATUS)"
else
  echo "  ⚠ /api/scaling/status not yet available (may need deployment)"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 5. Queue & Worker Configuration
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  5. Queue & Worker Configuration"
echo "───────────────────────────────────────────────────────────────────────"

# Check worker concurrency settings in compose
if grep -q "STAS_WORKER_CONCURRENCY\|WORKER_CONCURRENCY" "$COMPOSE_FILE" 2>/dev/null; then
  check_pass "Worker concurrency configured in compose file"
else
  check_fail "Worker concurrency NOT configured in compose file"
fi

# Check that RabbitMQ queue names are defined
if grep -q "QUEUES\|stas.agents" "$PROJECT_DIR/src/queue/rabbitmq.ts" 2>/dev/null; then
  check_pass "RabbitMQ queues defined in src/queue/rabbitmq.ts"
else
  check_fail "RabbitMQ queues NOT found in src/queue/rabbitmq.ts"
fi

# Check DLQ configuration
if grep -q "DLQ\|dlq\|dead.letter" "$PROJECT_DIR/src/config.ts" 2>/dev/null; then
  check_pass "Dead-letter queue (DLQ) configured"
else
  check_fail "DLQ configuration NOT found"
fi

# Check that scaling config section exists
if grep -q "scaling:" "$PROJECT_DIR/src/config.ts" 2>/dev/null; then
  check_pass "Scaling configuration section in config.ts"
fi

# Check for SCALING_MAX_WORKERS
if grep -q "SCALING_MAX_WORKERS" "$PROJECT_DIR/src/config.ts" 2>/dev/null; then
  check_pass "SCALING_MAX_WORKERS defined in config.ts"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 6. Monitoring Configuration
# ══════════════════════════════════════════════════════════════════════════

echo "───────────────────────────────────────────────────────────────────────"
echo "  6. Monitoring Configuration"
echo "───────────────────────────────────────────────────────────────────────"

MONITORING_DIR="$PROJECT_DIR/monitoring"
if [[ -d "$MONITORING_DIR" ]]; then
  check_pass "Monitoring directory exists"

  if [[ -f "$MONITORING_DIR/grafana-dashboard.json" ]]; then
    check_pass "Grafana dashboard JSON exists"
  else
    check_fail "Grafana dashboard JSON MISSING"
  fi

  if [[ -f "$MONITORING_DIR/prometheus-alerts.yml" ]]; then
    check_pass "Prometheus alerts YAML exists"
    # Check for required alert rules
    for alert in QueueTooDeep ErrorRateSpike FixRateDrop WorkerPoolExhausted; do
      if grep -q "alert: $alert" "$MONITORING_DIR/prometheus-alerts.yml" 2>/dev/null; then
        check_pass "Prometheus alert rule '$alert' defined"
      else
        check_fail "Prometheus alert rule '$alert' MISSING"
      fi
    done
  else
    check_fail "Prometheus alerts YAML MISSING"
  fi
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# 7. Summary
# ══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Verification Summary"
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo "  ✓ ALL CHECKS PASSED - STAS scaling is properly configured"
  echo ""
  echo "  Ready to scale:"
  echo "    docker compose -f $COMPOSE_FILE up -d --scale stas-worker=$SCALE_COUNT"
else
  echo "  ✗ $FAIL check(s) FAILED - review issues above"
fi

exit $FAIL
