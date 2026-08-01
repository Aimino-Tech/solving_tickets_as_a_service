#!/bin/bash
# Wait for all integration test services to be healthy
set -e

MAX_RETRIES=30
SLEEP=5

wait_for() {
  local name=$1
  local url=$2
  local retries=0

  echo "Waiting for $name ($url)..."
  until curl -sf "$url" > /dev/null 2>&1; do
    retries=$((retries + 1))
    if [ $retries -ge $MAX_RETRIES ]; then
      echo "FAILED: $name not ready after $MAX_RETRIES attempts"
      exit 1
    fi
    sleep $SLEEP
  done
  echo "OK: $name is healthy"
}

# OpenSymphony is an optional upstream (skipped in the integration tests when
# unavailable), so a slow or failed OS boot must not fail the whole job.
wait_for_optional() {
  local name=$1
  local url=$2
  local retries=0

  echo "Waiting (best-effort) for $name ($url)..."
  until curl -sf "$url" > /dev/null 2>&1; do
    retries=$((retries + 1))
    if [ $retries -ge $MAX_RETRIES ]; then
      echo "WARN: $name not ready after $MAX_RETRIES attempts — integration tests will skip its assertions"
      return 0
    fi
    sleep $SLEEP
  done
  echo "OK: $name is healthy"
}

COMPOSE_FILE="tests/integration/docker-compose.yml"

# STAS's /health endpoint queries the health_checks table, so migrations must run
# before the stack can be considered healthy.
echo "Running STAS database migrations..."
docker compose -f "$COMPOSE_FILE" exec -T stas node dist/src/db/migrate.js

wait_for "STAS API" "http://localhost:4095/health"
wait_for "Governance Proxy" "http://localhost:4003/guardrail/health"
wait_for_optional "OpenSymphony API" "http://localhost:4004/health"
echo "All services healthy. Running integration tests..."
