#!/bin/sh
# =============================================================================
# RabbitMQ Initialization Script
#
# Creates the syntaro-monitor monitoring user, the /syntaro-dev vhost, and sets
# appropriate permissions. Uses rabbitmqctl (must run on the RabbitMQ node).
#
# Usage:
#   # Inside the RabbitMQ container or on the RabbitMQ host:
#   bash scripts/init-rabbitmq.sh
#
#   # With custom password for the monitor user:
#   SYNTARO_MONITOR_PASSWORD=my-secure-pass bash scripts/init-rabbitmq.sh
#
# This script is idempotent — resources that already exist are skipped.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
SYNTARO_MONITOR_PASSWORD="${SYNTARO_MONITOR_PASSWORD:-syntaro-monitor-password}"
SYNTARO_DEV_VHOST="${SYNTARO_DEV_VHOST:-/syntaro-dev}"
SYNTARO_APP_USER="${SYNTARO_APP_USER:-syntaro-app}"
SYNTARO_MONITOR_USER="${SYNTARO_MONITOR_USER:-syntaro-monitor}"
SYNTARO_VHOST="${SYNTARO_VHOST:-/syntaro}"

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------
if ! command -v rabbitmqctl >/dev/null 2>&1; then
  echo "ERROR: rabbitmqctl not found. This script must run on the RabbitMQ node."
  echo "  In Docker: docker exec <container> bash /opt/rabbitmq/init-rabbitmq.sh"
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
echo "--- syntaro-monitor user ---"
ensure_user "$SYNTARO_MONITOR_USER" "$SYNTARO_MONITOR_PASSWORD" "monitoring"

# --- Step 2: /syntaro-dev vhost ---
echo "--- /syntaro-dev vhost ---"
ensure_vhost "$SYNTARO_DEV_VHOST"

# --- Step 3: Permissions on /syntaro for syntaro-app (should already exist) ---
echo "--- Permissions on $SYNTARO_VHOST ---"
ensure_permissions "$SYNTARO_VHOST" "$SYNTARO_APP_USER" ".*" ".*" ".*"
ensure_permissions "$SYNTARO_VHOST" "$SYNTARO_MONITOR_USER" "" "" ".*"

# --- Step 4: Permissions on /syntaro-dev ---
echo "--- Permissions on $SYNTARO_DEV_VHOST ---"
ensure_permissions "$SYNTARO_DEV_VHOST" "$SYNTARO_APP_USER" ".*" ".*" ".*"
ensure_permissions "$SYNTARO_DEV_VHOST" "$SYNTARO_MONITOR_USER" "" "" ".*"

# --- Step 5: Verify ---
echo ""
echo "=== Verification ==="
echo "--- Users ---"
rabbitmqctl list_users
echo ""
echo "--- Vhosts ---"
rabbitmqctl list_vhosts
echo ""
echo "--- Permissions on $SYNTARO_VHOST ---"
rabbitmqctl list_permissions -p "$SYNTARO_VHOST"
echo ""
echo "--- Permissions on $SYNTARO_DEV_VHOST ---"
rabbitmqctl list_permissions -p "$SYNTARO_DEV_VHOST"

echo ""
echo "=== RabbitMQ initialization complete ==="
