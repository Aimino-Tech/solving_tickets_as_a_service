#!/bin/bash
# Wait for the integration test services to be healthy.
set -e

MAX_RETRIES=30
SLEEP=5

# Accept any HTTP response (200 or 503) — STAS /health returns 503 when deps are
# degraded but the API is still up.
wait_for() {
  local name=$1
  local url=$2
  local required=$3
  local retries=0

  echo "Waiting for $name ($url)..."
  until curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -qE "^[0-9]{3}$"; do
    retries=$((retries + 1))
    if [ $retries -ge $MAX_RETRIES ]; then
      if [ "$required" = "required" ]; then
        echo "FAILED: $name not ready after $MAX_RETRIES attempts"
        exit 1
      fi
      echo "WARN: $name not ready — governance-dependent tests will skip"
      return 0
    fi
    sleep $SLEEP
  done
  echo "OK: $name is reachable"
}

wait_for "STAS API" "http://localhost:4095/health" "required"
wait_for "Governance Proxy" "http://localhost:4003/guardrail/health" "optional"
echo "All services ready. Running integration tests..."
