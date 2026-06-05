#!/bin/sh
# =============================================================================
# RabbitMQ Initialization Script
#
# Creates the stas-monitor monitoring user and sets appropriate permissions
# on the /stas vhost. Uses rabbitmqctl (must run on the RabbitMQ node).
#
# Usage:
#   # Inside the RabbitMQ container or on the RabbitMQ host:
#   bash scripts/init-rabbitmq.sh
#
#   # With custom password for the monitor user:
#   STAS_MONITOR_PASSWORD=my-secure-pass bash scripts/init-rabbitmq.sh
#
# This script is idempotent — resources that already exist are skipped.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
STAS_MONITOR_PASSWORD="${STAS_MONITOR_PASSWORD:-stas-monitor-password}"
STAS_APP_USER="${STAS_APP_USER:-stas-app}"
STAS_MONITOR_USER="${STAS_MONITOR_USER:-stas-monitor}"
STAS_VHOST="${STAS_VHOST:-/stas}"

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------
if ! command -v rabbitmqctl >/dev/null 2>&1; then
  echo "ERROR: rabbitmqctl not found. This script must run on the RabbitMQ node."
  echo "  In Docker: docker exec <container> bash /app/scripts/init-rabbitmq.sh"
  exit 1
fi

# ---------------------------------------------------------------------------
# Wait for RabbitMQ to be ready (skip if already running)
# ---------------------------------------------------------------------------
echo "Waiting for RabbitMQ to be ready..."
if ! rabbitmqctl status >/dev/null 2>&1; then
  echo "ERROR: RabbitMQ is not running. Start it first."
  exit 1
fi
echo "RabbitMQ is ready."

# ---------------------------------------------------------------------------
# Helper: create vhost if it doesn't exist
# ---------------------------------------------------------------------------
ensure_vhost() {
  local vhost="$1"
  if rabbitmqctl list_vhosts -q 2>/dev/null | grep -Fxq "$vhost"; then
    echo "  [SKIP] Vhost '$vhost' already exists"
  else
    echo "  [CREATE] Vhost '$vhost'"
    rabbitmqctl add_vhost "$vhost"
  fi
}

# ---------------------------------------------------------------------------
# Helper: create user if it doesn't exist
# ---------------------------------------------------------------------------
ensure_user() {
  local user="$1"
  local password="$2"
  local tags="${3:-}"
  if rabbitmqctl list_users -q 2>/dev/null | cut -d$'\t' -f1 | grep -Fxq "$user"; then
    echo "  [SKIP] User '$user' already exists"
  else
    echo "  [CREATE] User '$user'"
    rabbitmqctl add_user "$user" "$password"
    if [ -n "$tags" ]; then
      rabbitmqctl set_user_tags "$user" "$tags"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Helper: set permissions
# ---------------------------------------------------------------------------
ensure_permissions() {
  local vhost="$1"
  local user="$2"
  local configure="$3"
  local write="$4"
  local read="$5"
  echo "  [PERMISSIONS] vhost=$vhost user=$user configure=$configure write=$write read=$read"
  rabbitmqctl set_permissions -p "$vhost" "$user" "$configure" "$write" "$read"
}

# ===========================================================================
# Main
# ===========================================================================
echo ""
echo "=== RabbitMQ Initialization ==="
echo ""

# --- Step 1: Monitoring user ---
echo "--- stas-monitor user ---"
ensure_user "$STAS_MONITOR_USER" "$STAS_MONITOR_PASSWORD" "monitoring"

# --- Step 2: Permissions on /stas for stas-app (should already exist) ---
echo "--- Permissions on $STAS_VHOST ---"
ensure_permissions "$STAS_VHOST" "$STAS_APP_USER" ".*" ".*" ".*"
ensure_permissions "$STAS_VHOST" "$STAS_MONITOR_USER" "" "" ".*"

# --- Step 3: Verify ---
echo ""
echo "=== Verification ==="
echo "--- Users ---"
rabbitmqctl list_users
echo ""
echo "--- Vhosts ---"
rabbitmqctl list_vhosts
echo ""
echo "--- Permissions on $STAS_VHOST ---"
rabbitmqctl list_permissions -p "$STAS_VHOST"

echo ""
echo "=== RabbitMQ initialization complete ==="
