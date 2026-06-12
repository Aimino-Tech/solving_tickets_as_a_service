#!/bin/bash
# ============================================================
# Linear MCP — restart helper
# Uses cached OAuth token at ~/.mcp-auth/ to skip re-auth
# ============================================================
set -e

SESSION="mcp-linear"
PORT="22227"
LINEAR_MCP_URL="https://mcp.linear.app/mcp"

# Kill existing session if any
tmux kill-session -t "$SESSION" 2>/dev/null || true
sleep 1

# Start fresh
tmux new-session -d -s "$SESSION" \
  "npx -y mcp-remote --port $PORT --auth-timeout 120 '$LINEAR_MCP_URL'; exec bash"

echo "✅ Linear MCP server started on port $PORT"
echo "   TMUX session: $SESSION"
echo "   Token cached at: ~/.mcp-auth/"
