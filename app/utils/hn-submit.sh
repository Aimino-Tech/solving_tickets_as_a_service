#!/usr/bin/env bash
# HN Submit — fast-html-mcp Show HN
# Run with: bash app/utils/hn-submit.sh

TAB_ID="72B4279CE3C150D7D0EEA451AB041925"
SUBMIT_URL="https://news.ycombinator.com/submit"
GITHUB_URL="https://github.com/Aimino-Tech/fast-html-mcp"
COOKIE="user=xdnaimino%268UhFfEetpNe34iQdNqaMjf66i9EsAyjW"

echo "=== HN Submit: fast-html-mcp ==="

echo "[1] Setting session cookie..."
openclaw browser evaluate "$TAB_ID" "document.cookie = '$COOKIE; domain=.ycombinator.com; path=/';"

echo "[2] Refreshing page with cookie..."
openclaw browser navigate "$TAB_ID" "$SUBMIT_URL"

sleep 2

echo "[3] Checking login status..."
openclaw browser snapshot "$TAB_ID" --format aria --limit 20

echo "[4] Filling submission form..."
openclaw browser fill "$TAB_ID" '{"title":"Show HN: Fast HTML MCP — MCP server that lets AI agents write HTML directly to your filesystem","url":"https://github.com/Aimino-Tech/fast-html-mcp"}'

echo "[5] Taking screenshot..."
openclaw browser screenshot "$TAB_ID"

echo "=== Done ==="
