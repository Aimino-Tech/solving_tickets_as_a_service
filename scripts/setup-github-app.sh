#!/usr/bin/env bash
set -eu

# setup-github-app.sh — Create a GitHub App for SYNTARO
#
# This script:
#   1. Generates the GitHub App private key and webhook secret
#   2. Creates a pre-filled manifest URL for GitHub App registration
#   3. Generates the .env entries you need

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

echo "╔══════════════════════════════════════════════╗"
echo "║     SYNTARO — GitHub App Setup                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Generate secrets ──────────────────────────────────────────────────────────

WEBHOOK_SECRET=$(openssl rand -hex 32)
KEY_FILE="$ROOT/.syntaro-private-key.pem"

if [ ! -f "$KEY_FILE" ]; then
  echo "Generating RSA private key..."
  openssl genpkey -algorithm RSA -out "$KEY_FILE" -pkeyopt rsa_keygen_bits:2048 2>/dev/null
  chmod 600 "$KEY_FILE"
  echo "  ✓ Private key saved to $KEY_FILE"
else
  echo "  ✓ Using existing private key at $KEY_FILE"
fi

# ── Create manifest ──────────────────────────────────────────────────────────

MANIFEST=$(cat << 'MANIFEST_JSON'
{
  "name": "SYNTARO-bot",
  "url": "https://github.com/tamnguyen08/solving_tickets_as_a_service",
  "description": "Solving Tickets As A Service — automated fix bot",
  "hook_attributes": {
    "url": "https://smee.io/syntaro-bot"
  },
  "public": false,
  "default_events": ["issues", "issue_comment", "pull_request", "marketplace_purchase"],
  "default_permissions": {
    "issues": "write",
    "pull_requests": "write",
    "contents": "write",
    "metadata": "read"
  },
  "redirect_url": "https://github.com/tamnguyen08/solving_tickets_as_a_service"
}
MANIFEST_JSON
)

MANIFEST_B64=$(echo "$MANIFEST" | base64 -w0 2>/dev/null || echo "$MANIFEST" | base64)
MANIFEST_URL="https://github.com/settings/apps/new?state=$MANIFEST_B64"

echo ""
echo "── Step 1: Register the GitHub App ──"
echo ""
echo "Click this link to create your GitHub App:"
echo ""
echo "  $MANIFEST_URL"
echo ""
echo "This pre-fills all required permissions and events."
echo "After creation, GitHub will show you your App ID."
echo ""

# ── Prompt for App ID ─────────────────────────────────────────────────────────

read -rp "Enter your App ID (from the GitHub page): " APP_ID
while [ -z "$APP_ID" ]; do
  echo "App ID is required."
  read -rp "Enter your App ID: " APP_ID
done

# ── Generate .env ──────────────────────────────────────────────────────────────

PRIVATE_KEY=$(cat "$KEY_FILE" | sed 's/$/\\n/' | tr -d '\n' | sed 's/\\n$//')

cat > "$ENV_FILE" << ENVEOF
# === GitHub App ===
GITHUB_APP_ID=$APP_ID
GITHUB_APP_PRIVATE_KEY=$PRIVATE_KEY
GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET

# === Queue (Redis) ===
REDIS_URL=redis://localhost:6379

# === OpenCode ===
OPENCODE_URL=http://localhost:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514

# === OpenCode Go Direct LLM (optional, replaces OpenAI) ===
# OPENCODE_API_KEY=sk-...
# OPENCODE_CHEAP_MODEL=deepseek-v4-flash
# OPENCODE_FIX_MODEL=deepseek-v4-pro

# === Sandbox (E2B - optional for dev) ===
# E2B_API_KEY=...

# === Bot Settings ===
SYNTARO_LABEL=syntaro:fix
BOT_NAME=SYNTARO
PORT=3000
ENVEOF

echo ""
echo "── Step 2: Configure your GitHub App ──"
echo ""
echo "In your GitHub App settings (https://github.com/settings/apps):"
echo "  1. Set Webhook URL to your smee.io URL or your server URL"
echo "     For local dev: use https://smee.io/syntaro-bot (see step 2b)"
echo "  2. Generate a private key and download it (or use the one we generated)"
echo "  3. Install the app on a repo"
echo ""
echo "── Step 2b: Webhook forwarding (local dev only) ──"
echo ""
echo "  For local development, GitHub can't reach localhost."
echo "  Use smee.io to forward webhooks to your machine:"
echo ""
echo "  1. Visit https://smee.io/new and create a channel"
echo "  2. Set your GitHub App's Webhook URL to the smee URL"
echo "  3. Run the smee client:  npx tsx scripts/smee.ts --url <smee-url>"
echo ""
echo "── Generated .env ──"
echo ""
echo "  GITHUB_APP_ID:        $APP_ID"
echo "  GITHUB_WEBHOOK_SECRET: $WEBHOOK_SECRET"
echo "  Private key:          $KEY_FILE"
echo ""
echo "── Next Steps ──"
echo ""
echo "  1. redis-server &                  # Start Redis"
echo "  2. opencode serve --port 4096 &   # Start OpenCode"
echo "  3. (dev only) npx tsx scripts/smee.ts --url <smee-url>"
echo "  4. npm run dev                     # Start SYNTARO"
echo "  5. Label an issue with 'syntaro:fix'  # Trigger a fix"
