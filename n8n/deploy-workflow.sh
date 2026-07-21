#!/usr/bin/env bash
set -euo pipefail

N8N_URL="${N8N_URL:-http://localhost:5678}"
N8N_API_KEY="${N8N_API_KEY:-}"
WORKFLOW_FILE="${1:?Usage: $0 <workflow.json> [activate=true]}"
ACTIVATE="${2:-true}"

if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "Error: Workflow file not found: $WORKFLOW_FILE"
  exit 1
fi

echo "=== Deploying workflow: $WORKFLOW_FILE ==="

AUTH_HEADER=""
if [ -n "$N8N_API_KEY" ]; then
  AUTH_HEADER="X-N8N-API-KEY: $N8N_API_KEY"
fi

WORKFLOW_JSON=$(cat "$WORKFLOW_FILE")

echo "Creating workflow via REST API..."
RESPONSE=$(curl -s -X POST "$N8N_URL/rest/workflows" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -H "Content-Type: application/json" \
  -d "$WORKFLOW_JSON")

WORKFLOW_ID=$(echo "$RESPONSE" | jq -r '.data.id // empty')

if [ -z "$WORKFLOW_ID" ]; then
  echo "Error: Failed to create workflow"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "Workflow created: $WORKFLOW_ID"

if [ "$ACTIVATE" = "true" ]; then
  echo "Activating workflow..."
  ACTIVATE_RESPONSE=$(curl -s -X POST "$N8N_URL/rest/workflows/$WORKFLOW_ID/activate" \
    ${AUTH_HEADER:+-H "$AUTH_HEADER"})
  echo "Workflow activated"
fi

echo "=== Deploy complete ==="
echo "Workflow ID: $WORKFLOW_ID"

WEBHOOK_ID=$(echo "$WORKFLOW_JSON" | jq -r '.nodes[] | select(.type == "n8n-nodes-base.webhook") | .parameters.path // empty' | head -1)
if [ -n "$WEBHOOK_ID" ]; then
  echo "Webhook URL: $N8N_URL/webhook/$WEBHOOK_ID"
fi
