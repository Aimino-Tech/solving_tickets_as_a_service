#!/usr/bin/env bash
set -eu

# stas-status — Check STAS bot and OpenCode serve health
#
# SYNOPSIS
#   stas-status
#
# DESCRIPTION
#   Checks whether the STAS bot and OpenCode serve are running and healthy.
#   Can be used as a standalone CLI tool or invoked by the STAS OpenCode
#   plugin (stas_status tool).
#
# ENVIRONMENT
#   STAS_URL       STAS bot URL (default: http://localhost:3000)
#   OPENCODE_URL   OpenCode serve URL (default: http://localhost:4096)

STAS_URL="${STAS_URL:-http://localhost:3000}"
OPENCODE_URL="${OPENCODE_URL:-http://localhost:4096}"

echo "=== STAS Status ==="
echo ""

# STAS bot
if curl -sf "$STAS_URL/health" > /dev/null 2>&1; then
  STATUS=$(curl -sf "$STAS_URL/health" 2>/dev/null)
  echo "✅ STAS bot: running"
  echo "   $STATUS"
else
  echo "❌ STAS bot: not reachable at $STAS_URL"
fi

echo ""

# OpenCode serve
if curl -sf "$OPENCODE_URL" > /dev/null 2>&1; then
  echo "✅ OpenCode serve: running on $OPENCODE_URL"
else
  echo "❌ OpenCode serve: not reachable at $OPENCODE_URL"
fi

echo ""

# Process check (best-effort)
if command -v pgrep &>/dev/null; then
  STAS_PID=$(pgrep -f "tsx.*src/index.ts" 2>/dev/null || pgrep -f "node.*dist/index.js" 2>/dev/null || echo "")
  OC_PID=$(pgrep -f "opencode serve" 2>/dev/null || echo "")
  [ -n "$STAS_PID" ] && echo "   STAS process: PID $STAS_PID" || echo "   STAS process: not running"
  [ -n "$OC_PID" ] && echo "   OpenCode process: PID $OC_PID" || echo "   OpenCode process: not running"
fi

echo ""
echo "=== End ==="
