#!/usr/bin/env bash
set -eu

# stas-webhook-test — Simulate a GitHub webhook event locally
# Usage: stas-webhook-test <event> <payload-file>
#
# Events:
#   issues.labeled   Simulate labeling an issue (default)
#   issues.opened    Simulate opening an issue
#
# If no payload file given, generates a default test payload.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAS_URL="${STAS_URL:-http://localhost:3000}"
EVENT="${1:-issues.labeled}"
PAYLOAD_FILE="${2:-}"

if [ -z "$PAYLOAD_FILE" ]; then
  # Generate a default test payload
  PAYLOAD_FILE=$(mktemp)
  cat > "$PAYLOAD_FILE" << 'PAYLOAD'
{
  "action": "labeled",
  "label": { "name": "stas:fix" },
  "issue": {
    "number": 1,
    "title": "Test: Fix null reference in auth handler",
    "body": "When user token is expired, the auth handler throws a null reference error on line 42 of auth.ts. Expected: graceful redirect to login.",
    "html_url": "https://github.com/owner/repo/issues/1",
    "labels": [{ "name": "stas:fix" }]
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

echo "Sending $EVENT to $STAS_URL/webhook/github..."
echo "Payload: $(cat "$PAYLOAD_FILE" | head -5)"
echo "---"

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$STAS_URL/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: test-$(date +%s)" \
  -d @"$PAYLOAD_FILE")

echo "HTTP Status: $RESPONSE"

if [ "$RESPONSE" = "200" ]; then
  echo "✅ Webhook accepted. Check STAS logs for agent dispatch."
else
  echo "❌ Webhook failed."
fi

[ "$CLEANUP_PAYLOAD" = "1" ] && rm "$PAYLOAD_FILE"
