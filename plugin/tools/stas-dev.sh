#!/usr/bin/env bash
set -eu

# stas-dev — Start local STAS development environment
# Usage: stas-dev [--bot-only] [--opencode-only]
#
# Starts opencode serve + STAS bot in parallel.
# Requires .env to be configured (use stas-config first).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
STAS_PORT="${STAS_PORT:-3000}"

start_opencode() {
  echo "Starting OpenCode serve on :${OPENCODE_PORT}..."
  if command -v opencode &>/dev/null; then
    opencode serve --port "$OPENCODE_PORT" &
    echo "OpenCode PID: $!"
  else
    echo "ERROR: opencode CLI not found. Install from https://opencode.ai"
    exit 1
  fi
}

start_stas() {
  echo "Starting STAS bot on :${STAS_PORT}..."
  cd "$ROOT"
  if [ -f .env ]; then
    npm run dev &
    echo "STAS PID: $!"
  else
    echo "ERROR: .env not found. Run stas-config first."
    exit 1
  fi
}

cleanup() {
  echo "Shutting down..."
  kill 0 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

if [ "${1:-}" = "--opencode-only" ]; then
  start_opencode
elif [ "${1:-}" = "--bot-only" ]; then
  start_stas
else
  start_opencode
  sleep 2
  start_stas
fi

wait
