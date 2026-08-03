#!/usr/bin/env bash
set -eu

# stas-dev — Start local STAS development environment
#
# SYNOPSIS
#   stas-dev [--bot-only] [--opencode-only]
#
# DESCRIPTION
#   Starts OpenCode serve + STAS bot in parallel. Can be used as a standalone
#   CLI tool or invoked by the STAS OpenCode plugin (stas_dev_start tool).
#
#   --bot-only       Start only the STAS bot
#   --opencode-only  Start only OpenCode serve
#   (no flag)        Start both (default)
#
# ENVIRONMENT
#   OPENCODE_PORT   Port for OpenCode serve (default: 4096)
#   STAS_PORT       Port for STAS bot (default: 3000)

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
  if [ ! -f "$ROOT/.env" ]; then
    echo "ERROR: .env not found at $ROOT/.env"
    echo "   Run: stas-config init"
    exit 1
  fi

  echo "Starting STAS bot on :${STAS_PORT}..."
  cd "$ROOT"
  npm run dev &
  echo "STAS PID: $!"
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
  start_stas
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: stas-dev [--bot-only] [--opencode-only]"
  echo ""
  echo "Start local STAS development environment."
  echo ""
  echo "Flags:"
  echo "  --bot-only       Start only the STAS bot"
  echo "  --opencode-only  Start only OpenCode serve"
  echo "  (no flag)        Start both"
  echo ""
  echo "Environment variables:"
  echo "  OPENCODE_PORT   Port for OpenCode (default: 4096)"
  echo "  STAS_PORT       Port for STAS bot (default: 3000)"
  exit 0
else
  start_opencode
  sleep 2
  start_stas
fi

wait
