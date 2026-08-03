#!/usr/bin/env bash
set -eu

# syntaro-dev — Start local SYNTARO development environment
#
# SYNOPSIS
#   syntaro-dev [--bot-only] [--opencode-only]
#
# DESCRIPTION
#   Starts OpenCode serve + SYNTARO bot in parallel. Can be used as a standalone
#   CLI tool or invoked by the SYNTARO OpenCode plugin (syntaro_dev_start tool).
#
#   --bot-only       Start only the SYNTARO bot
#   --opencode-only  Start only OpenCode serve
#   (no flag)        Start both (default)
#
# ENVIRONMENT
#   OPENCODE_PORT   Port for OpenCode serve (default: 4096)
#   SYNTARO_PORT       Port for SYNTARO bot (default: 3000)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
SYNTARO_PORT="${SYNTARO_PORT:-3000}"

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

start_syntaro() {
  if [ ! -f "$ROOT/.env" ]; then
    echo "ERROR: .env not found at $ROOT/.env"
    echo "   Run: syntaro-config init"
    exit 1
  fi

  echo "Starting SYNTARO bot on :${SYNTARO_PORT}..."
  cd "$ROOT"
  npm run dev &
  echo "SYNTARO PID: $!"
}

cleanup() {
  echo ""
  echo "Shutting down..."
  kill 0 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

if [ "${1:-}" = "--opencode-only" ]; then
  start_opencode
elif [ "${1:-}" = "--bot-only" ]; then
  start_syntaro
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: syntaro-dev [--bot-only] [--opencode-only]"
  echo ""
  echo "Start local SYNTARO development environment."
  echo ""
  echo "Flags:"
  echo "  --bot-only       Start only the SYNTARO bot"
  echo "  --opencode-only  Start only OpenCode serve"
  echo "  (no flag)        Start both"
  echo ""
  echo "Environment variables:"
  echo "  OPENCODE_PORT   Port for OpenCode (default: 4096)"
  echo "  SYNTARO_PORT       Port for SYNTARO bot (default: 3000)"
  exit 0
else
  start_opencode
  sleep 2
  start_syntaro
fi

wait
