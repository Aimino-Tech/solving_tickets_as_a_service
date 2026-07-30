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

wait_for "STAS API" "http://localhost:4095/health"
wait_for "Governance Proxy" "http://localhost:4003/guardrail/health"
echo "All services healthy. Running integration tests..."
