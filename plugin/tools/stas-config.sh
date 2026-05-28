#!/usr/bin/env bash
set -eu

# stas-config — Validate or initialize STAS .env configuration
# Usage: stas-config [init|check]
#
#   init    Create .env from .env.example (interactive)
#   check   Validate existing .env (default)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CMD="${1:-check}"

check_env() {
  local ENV_FILE="$ROOT/.env"
  local EXAMPLE_FILE="$ROOT/.env.example"
  local missing=()
  local errors=0

  if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env not found. Run: stas-config init"
    exit 1
  fi

  echo "Checking $ENV_FILE..."

  # Source and check required vars
  set -a
  source "$ENV_FILE"
  set +a

  [ -z "${GITHUB_APP_ID:-}" ] && missing+=("GITHUB_APP_ID") && errors=$((errors + 1))
  [ -z "${GITHUB_PRIVATE_KEY:-}" ] && missing+=("GITHUB_PRIVATE_KEY") && errors=$((errors + 1))
  [ -z "${GITHUB_WEBHOOK_SECRET:-}" ] && missing+=("GITHUB_WEBHOOK_SECRET") && errors=$((errors + 1))

  if [ "$errors" -gt 0 ]; then
    echo "❌ Missing required vars: ${missing[*]}"
    exit 1
  fi

  # Verify OpenCode is reachable
  local OC_URL="${OPENCODE_URL:-http://localhost:4096}"
  if curl -sf "$OC_URL/api/run" -X POST -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1; then
    echo "✅ OpenCode reachable at $OC_URL"
  else
    echo "⚠️  OpenCode not reachable at $OC_URL (expected if not running)"
  fi

  echo "✅ Config looks good. Label: ${STAS_LABEL:-stas:fix}"
}

init_env() {
  local ENV_FILE="$ROOT/.env"
  local EXAMPLE_FILE="$ROOT/.env.example"

  if [ -f "$ENV_FILE" ]; then
    echo "⚠️  .env already exists. Run 'stas-config check' to validate."
    exit 0
  fi

  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "❌ .env.example not found."
    exit 1
  fi

  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "✅ Created $ENV_FILE from template."
  echo ""
  echo "Edit the file with your values:"
  echo "  GITHUB_APP_ID     — From GitHub App settings"
  echo "  GITHUB_PRIVATE_KEY — PEM file contents (use \\n for newlines)"
  echo "  GITHUB_WEBHOOK_SECRET — Random secret for webhook verification"
  echo ""
  echo "Then run: stas-config check"
}

case "$CMD" in
  init) init_env ;;
  check|validate) check_env ;;
  *)
    echo "Usage: stas-config [init|check]"
    exit 1
    ;;
esac
