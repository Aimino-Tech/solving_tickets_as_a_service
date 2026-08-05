#!/usr/bin/env bash
# dev-api.sh — Start the SYNTARO API dev server with automatic port fallback.
#
# The dashboard proxies /api to a fixed port. On shared machines other
# processes (or stale builds) often grab that port, which makes the API fail
# to start or serve stale routes. Instead of breaking, this launcher:
#
#   1. Tries the preferred port (env PORT, else 3002).
#   2. If taken, falls back to 3030, then 3031..3040.
#   3. Writes the winning port to dashboard/.api-port so the Vite dev server
#      proxies to the ACTUAL live port (see dashboard/vite.config.ts).
#
# Usage:
#   npm run dev:api            # preferred 3002, auto-fallback on conflict
#   PORT=3005 npm run dev:api  # explicit preferred port
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$ROOT/dashboard/.api-port"

PREFERRED="${PORT:-3002}"
FALLBACK_START=3030
FALLBACK_MAX=3040

port_in_use() {
  ss -tln 2>/dev/null | grep -qE ":$1([[:space:]]|$)"
}

resolve_port() {
  if ! port_in_use "$PREFERRED"; then
    echo "$PREFERRED"
    return
  fi
  echo "[dev-api] port $PREFERRED is in use — falling back" >&2
  for p in $(seq "$FALLBACK_START" "$FALLBACK_MAX"); do
    if ! port_in_use "$p"; then
      echo "[dev-api] using fallback port $p" >&2
      echo "$p"
      return
    fi
  done
  echo "[dev-api] ERROR: no free port in $FALLBACK_START..$FALLBACK_MAX" >&2
  exit 1
}

PORT="$(resolve_port)"
echo "$PORT" > "$PORT_FILE"
echo "[dev-api] API port -> $PORT (written to $PORT_FILE)" >&2

cd "$ROOT"
exec env RUN_MODE=api PORT="$PORT" "$ROOT/node_modules/.bin/tsx" watch src/index.ts
