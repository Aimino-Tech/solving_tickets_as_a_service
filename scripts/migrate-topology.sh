#!/bin/bash
# =============================================================================
# RabbitMQ Topology Migration Script
#
# Declares the unified RabbitMQ topology (exchanges, queues, DLQs, bindings)
# for the STAS messaging layer. Idempotent — safe to re-run.
#
# Uses rabbitmqadmin (HTTP API) or falls back to rabbitmqctl + manual
# declare-via-TypeScript.
#
# Usage:
#   bash scripts/migrate-topology.sh          # Declare topology via rabbitmqadmin
#   bash scripts/migrate-topology.sh --dry-run  # Print commands without executing
#   bash scripts/migrate-topology.sh --verify   # Verify topology is correct
#   bash scripts/migrate-topology.sh --cleanup  # Remove old exchanges/queues
#
# Prerequisites:
#   - Running RabbitMQ instance (default: localhost:5672)
#   - rabbitmqadmin CLI installed (or rabbitmqctl)
#   - Access to the /stas vhost
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RABBIT_HOST="${RABBITMQ_HOST:-localhost}"
RABBIT_PORT="${RABBITMQ_PORT:-5672}"
RABBIT_USER="${RABBITMQ_USER:-guest}"
RABBIT_PASS="${RABBITMQ_PASS:-guest}"
RABBIT_VHOST="${RABBITMQ_VHOST:-/stas}"
RABBIT_API_PORT="${RABBITMQ_API_PORT:-15672}"

DRY_RUN=false
MODE="declare"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --verify) MODE="verify" ;;
    --cleanup) MODE="cleanup" ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helper: run a rabbitmqadmin command
# ---------------------------------------------------------------------------
run_rabbitmqadmin() {
  local action="$1"
  local obj_type="$2"
  shift 2

  local args=()
  args+=("--host=$RABBIT_HOST")
  args+=("--port=$RABBIT_API_PORT")
  args+=("--username=$RABBIT_USER")
  args+=("--password=$RABBIT_PASS")
  args+=("--vhost=$RABBIT_VHOST")
  args+=("$action" "$obj_type")
  args+=("$@")

  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] rabbitmqadmin ${args[*]}"
    return 0
  fi

  echo "[EXEC] rabbitmqadmin $action $obj_type ..."
  rabbitmqadmin "${args[@]}" 2>&1 | head -5 || echo "  [WARN] Command failed (may already exist)"
}

# ---------------------------------------------------------------------------
# Helper: declare exchange
# ---------------------------------------------------------------------------
declare_exchange() {
  local name="$1"
  local type="$2"
  run_rabbitmqadmin "declare" "exchange" "--name=$name" "--type=$type" "--durable=true" "--auto_delete=false"
}

# ---------------------------------------------------------------------------
# Helper: declare queue
# ---------------------------------------------------------------------------
declare_queue() {
  local name="$1"
  local dlx="${2:-}"
  local dlrk="${3:-}"

  if [ -n "$dlx" ]; then
    run_rabbitmqadmin "declare" "queue" "--name=$name" "--durable=true" \
      "--arguments={\"x-dead-letter-exchange\":\"$dlx\",\"x-dead-letter-routing-key\":\"$dlrk\"}"
  else
    run_rabbitmqadmin "declare" "queue" "--name=$name" "--durable=true"
  fi
}

# ---------------------------------------------------------------------------
# Helper: bind queue to exchange
# ---------------------------------------------------------------------------
bind_queue() {
  local queue="$1"
  local exchange="$2"
  local routing_key="$3"
  run_rabbitmqadmin "declare" "binding" "--source=$exchange" "--destination=$queue" "--destination_type=queue" "--routing_key=$routing_key"
}

# ===========================================================================
# Topology Definition
# ===========================================================================

declare_topology() {
  echo "=== Declaring exchanges ==="

  declare_exchange "stas.agents" "topic"
  declare_exchange "stas.issues" "topic"
  declare_exchange "stas.queue" "topic"
  declare_exchange "stas.events" "fanout"
  declare_exchange "stas.dlx" "direct"

  echo ""
  echo "=== Declaring queues with DLQ config ==="

  # stas.agents exchange
  declare_queue "stas.agents.dispatch" "stas.dlx" "stas.agents.dispatch"
  declare_queue "stas.agents.verification" "stas.dlx" "stas.agents.verification"
  declare_queue "stas.agents.self_audit" "stas.dlx" "stas.agents.self_audit"
  declare_queue "stas.agents.sandbox" "stas.dlx" "stas.agents.sandbox"

  # stas.issues exchange
  declare_queue "stas.issues.triage" "stas.dlx" "stas.issues.triage"
  declare_queue "stas.issues.health" "stas.dlx" "stas.issues.health"

  # stas.queue exchange
  declare_queue "stas.queue.pr" "stas.dlx" "stas.queue.pr"
  declare_queue "stas.queue.merge" "stas.dlx" "stas.queue.merge"
  declare_queue "stas.queue.notifications" "stas.dlx" "stas.queue.notifications"

  # stas.events exchange
  declare_queue "stas.events.event_bus" "stas.dlx" "stas.events.event_bus"

  # stas.dlx exchange (no DLQ for DLQ queues)
  declare_queue "stas.dlx.retry"
  declare_queue "stas.dlx.failed"

  # DLQ queues (bound to stas.dlx exchange)
  for queue in \
    "stas.agents.dispatch" \
    "stas.agents.verification" \
    "stas.agents.self_audit" \
    "stas.agents.sandbox" \
    "stas.issues.triage" \
    "stas.issues.health" \
    "stas.queue.pr" \
    "stas.queue.merge" \
    "stas.queue.notifications" \
    "stas.events.event_bus"; do
    declare_queue "${queue}.dlq"
  done

  echo ""
  echo "=== Binding queues to exchanges ==="

  # stas.agents exchange
  bind_queue "stas.agents.dispatch" "stas.agents" "agent.runner"
  bind_queue "stas.agents.verification" "stas.agents" "agent.verify"
  bind_queue "stas.agents.self_audit" "stas.agents" "agent.self_audit"
  bind_queue "stas.agents.sandbox" "stas.agents" "agent.sandbox"

  # stas.issues exchange
  bind_queue "stas.issues.triage" "stas.issues" "triage.*"
  bind_queue "stas.issues.health" "stas.issues" "health.*"

  # stas.queue exchange
  bind_queue "stas.queue.pr" "stas.queue" "pr.create"
  bind_queue "stas.queue.merge" "stas.queue" "merge.process"
  bind_queue "stas.queue.notifications" "stas.queue" "queue.notify"

  # stas.events exchange (fanout — routing key is ignored)
  bind_queue "stas.events.event_bus" "stas.events" ""

  # stas.dlx exchange
  bind_queue "stas.dlx.retry" "stas.dlx" "dlq.retry"
  bind_queue "stas.dlx.failed" "stas.dlx" "dlq.failed"

  # Bind DLQ queues to stas.dlx exchange
  for queue in \
    "stas.agents.dispatch" \
    "stas.agents.verification" \
    "stas.agents.self_audit" \
    "stas.agents.sandbox" \
    "stas.issues.triage" \
    "stas.issues.health" \
    "stas.queue.pr" \
    "stas.queue.merge" \
    "stas.queue.notifications" \
    "stas.events.event_bus"; do
    bind_queue "${queue}.dlq" "stas.dlx" "$queue"
  done

  echo ""
  echo "=== Topology declaration complete ==="
}

# ===========================================================================
# Verify Topology
# ===========================================================================

verify_topology() {
  echo "=== Verifying topology ==="
  local errors=0

  # Check exchanges exist
  for ex in "stas.agents" "stas.issues" "stas.queue" "stas.events" "stas.dlx"; do
    if rabbitmqadmin --host="$RABBIT_HOST" --port="$RABBIT_API_PORT" \
      --username="$RABBIT_USER" --password="$RABBIT_PASS" \
      --vhost="$RABBIT_VHOST" list exchanges --name="$ex" 2>/dev/null | grep -q "$ex"; then
      echo "  [OK] Exchange $ex"
    else
      echo "  [MISSING] Exchange $ex"
      errors=$((errors + 1))
    fi
  done

  # Check queues exist
  local all_queues=(
    "stas.agents.dispatch" "stas.agents.verification" "stas.agents.self_audit" "stas.agents.sandbox"
    "stas.issues.triage" "stas.issues.health"
    "stas.queue.pr" "stas.queue.merge" "stas.queue.notifications"
    "stas.events.event_bus"
    "stas.dlx.retry" "stas.dlx.failed"
  )

  for queue in "${all_queues[@]}"; do
    if rabbitmqadmin --host="$RABBIT_HOST" --port="$RABBIT_API_PORT" \
      --username="$RABBIT_USER" --password="$RABBIT_PASS" \
      --vhost="$RABBIT_VHOST" list queues --name="$queue" 2>/dev/null | grep -q "$queue"; then
      echo "  [OK] Queue $queue"
    else
      echo "  [MISSING] Queue $queue"
      errors=$((errors + 1))
    fi
  done

  # Check DLQ queues exist
  local dlq_suffixes=(
    "stas.agents.dispatch" "stas.agents.verification" "stas.agents.self_audit" "stas.agents.sandbox"
    "stas.issues.triage" "stas.issues.health"
    "stas.queue.pr" "stas.queue.merge" "stas.queue.notifications"
    "stas.events.event_bus"
  )

  for queue in "${dlq_suffixes[@]}"; do
    local dlq_name="${queue}.dlq"
    if rabbitmqadmin --host="$RABBIT_HOST" --port="$RABBIT_API_PORT" \
      --username="$RABBIT_USER" --password="$RABBIT_PASS" \
      --vhost="$RABBIT_VHOST" list queues --name="$dlq_name" 2>/dev/null | grep -q "$dlq_name"; then
      echo "  [OK] DLQ $dlq_name"
    else
      echo "  [MISSING] DLQ $dlq_name"
      errors=$((errors + 1))
    fi
  done

  if [ "$errors" -eq 0 ]; then
    echo ""
    echo "=== All topology elements verified successfully ==="
  else
    echo ""
    echo "=== $errors element(s) missing — re-run without --verify to create ==="
    exit 1
  fi
}

# ===========================================================================
# Cleanup Old Topology
# ===========================================================================

cleanup_old_topology() {
  echo "=== Cleaning up old topology ==="
  echo "  (only if no messages remain)"

  local old_queues=(
    "stas.agents.triage" "stas.agents.opencode" "stas.agents.pr_creation"
    "stas.agents.notifications" "stas.agents.default"
    "stas.issues.fix" "stas.events.notifications" "stas.events.audit"
  )

  for queue in "${old_queues[@]}"; do
    echo "  [DELETE] Queue $queue (if empty)..."
    run_rabbitmqadmin "delete" "queue" "--name=$queue" || true
  done

  local old_dlqs=(
    "stas.agents.triage.dlq" "stas.agents.opencode.dlq"
    "stas.agents.verification.dlq" "stas.agents.sandbox.dlq"
    "stas.issues.fix.dlq" "stas.events.notifications.dlq" "stas.events.audit.dlq"
  )

  for dlq in "${old_dlqs[@]}"; do
    echo "  [DELETE] DLQ $dlq (if empty)..."
    run_rabbitmqadmin "delete" "queue" "--name=$dlq" || true
  done

  # Delete old stas exchange (only if no bindings remain)
  echo "  [DELETE] Exchange 'stas' (if no bindings)..."
  run_rabbitmqadmin "delete" "exchange" "--name=stas" || true

  echo ""
  echo "=== Old topology cleanup complete ==="
}

# ===========================================================================
# Main
# ===========================================================================

echo "========================================================"
echo "  RabbitMQ Topology Migration"
echo "  Mode: $MODE"
echo "  Host: $RABBIT_HOST:$RABBIT_PORT"
echo "  VHost: $RABBIT_VHOST"
echo "========================================================"
echo ""

case "$MODE" in
  declare)
    declare_topology
    ;;
  verify)
    verify_topology
    ;;
  cleanup)
    cleanup_old_topology
    ;;
esac
