#!/usr/bin/env bash
set -eu

# syntaro-webhook-test — Simulate a GitHub webhook event locally
#
# SYNOPSIS
#   syntaro-webhook-test [event] [payload-file]
#
# DESCRIPTION
#   Sends a test webhook event to a running SYNTARO bot. Can be used as a
#   standalone CLI tool or invoked by the SYNTARO OpenCode plugin
#   (syntaro_webhook_test tool).
#
# ARGUMENTS
#   event          GitHub webhook event type (default: issues.labeled)
#                  Common values: issues.labeled, issues.opened
#   payload-file   Path to JSON payload file
#                  (default: auto-generates a test payload)
#
# ENVIRONMENT
#   SYNTARO_URL   SYNTARO bot URL (default: http://localhost:3000)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYNTARO_URL="${SYNTARO_URL:-http://localhost:3000}"
EVENT="${1:-issues.labeled}"
PAYLOAD_FILE="${2:-}"

if [ "$EVENT" = "--help" ] || [ "$EVENT" = "-h" ]; then
  echo "Usage: syntaro-webhook-test [event] [payload-file]"
  echo ""
  echo "Send a test webhook event to a running SYNTARO bot."
  echo ""
  echo "Arguments:"
  echo "  event          Webhook event type (default: issues.labeled)"
  echo "  payload-file   Path to JSON payload file"
  echo ""
  echo "Examples:"
  echo "  syntaro-webhook-test issues.labeled"
  echo "  syntaro-webhook-test issues.opened ./test-payload.json"
  exit 0
fi

if [ -z "$PAYLOAD_FILE" ]; then
  # Generate a default test payload
  PAYLOAD_FILE=$(mktemp)
  cat > "$PAYLOAD_FILE" << 'PAYLOAD'
{
  "action": "labeled",
  "label": { "name": "syntaro:fix" },
  "issue": {
    "number": 1,
    "title": "Test: Fix null reference in auth handler",
    "body": "When user token is expired, the auth handler throws a null reference error on line 42 of auth.ts. Expected: graceful redirect to login.",
    "html_url": "https://github.com/owner/repo/issues/1",
    "labels": [{ "name": "syntaro:fix" }]
  },
  "repository": {
    "owner": { "login": "test-owner" },
    "name": "test-repo",
    "clone_url": "https://github.com/test-owner/test-repo.git"
  },
  "installation": { "id": 12345 }
}
PAYLOAD
  CLEANUP_PAYLOAD=1
else
  CLEANUP_PAYLOAD=0
fi

echo "Sending $EVENT to $SYNTARO_URL/webhook/github..."
echo "Payload: $(head -5 "$PAYLOAD_FILE")"
echo "---"

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$SYNTARO_URL/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: test-$(date +%s)" \
  -d @"$PAYLOAD_FILE")

echo "HTTP Status: $RESPONSE"

if [ "$RESPONSE" = "200" ]; then
  echo "✅ Webhook accepted. Check SYNTARO logs for agent dispatch."
else
  echo "❌ Webhook failed (HTTP $RESPONSE)."
  echo "   Is SYNTARO running at $SYNTARO_URL? Run: syntaro-status"
fi

[ "$CLEANUP_PAYLOAD" = "1" ] && rm "$PAYLOAD_FILE"
