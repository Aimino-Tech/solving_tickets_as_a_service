#!/usr/bin/env bash
set -eu

# syntaro-status — Check SYNTARO bot and OpenCode serve health
#
# SYNOPSIS
#   syntaro-status
#
# DESCRIPTION
#   Checks whether the SYNTARO bot and OpenCode serve are running and healthy.
#   Can be used as a standalone CLI tool or invoked by the SYNTARO OpenCode
#   plugin (syntaro_status tool).
#
# ENVIRONMENT
#   SYNTARO_URL       SYNTARO bot URL (default: http://localhost:3000)
#   OPENCODE_URL   OpenCode serve URL (default: http://localhost:4096)

SYNTARO_URL="${SYNTARO_URL:-http://localhost:3000}"
OPENCODE_URL="${OPENCODE_URL:-http://localhost:4096}"

echo "=== SYNTARO Status ==="
echo ""

# SYNTARO bot
if curl -sf "$SYNTARO_URL/health" > /dev/null 2>&1; then
  STATUS=$(curl -sf "$SYNTARO_URL/health" 2>/dev/null)
  echo "✅ SYNTARO bot: running"
  echo "   $STATUS"
else
  echo "❌ SYNTARO bot: not reachable at $SYNTARO_URL"
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
  SYNTARO_PID=$(pgrep -f "tsx.*src/index.ts" 2>/dev/null || pgrep -f "node.*dist/index.js" 2>/dev/null || echo "")
  OC_PID=$(pgrep -f "opencode serve" 2>/dev/null || echo "")
  [ -n "$SYNTARO_PID" ] && echo "   SYNTARO process: PID $SYNTARO_PID" || echo "   SYNTARO process: not running"
  [ -n "$OC_PID" ] && echo "   OpenCode process: PID $OC_PID" || echo "   OpenCode process: not running"
fi

echo ""
echo "=== End ==="
