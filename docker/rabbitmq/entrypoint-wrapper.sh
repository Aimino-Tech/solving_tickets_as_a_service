#!/bin/sh
# =============================================================================
# RabbitMQ Entrypoint Wrapper
#
# This wrapper is used by the custom RabbitMQ Docker image (docker/rabbitmq/).
# It starts the RabbitMQ server, waits for it to be ready, runs the
# initialization script, then brings the server to the foreground.
#
# Usage is identical to the official RabbitMQ entrypoint — pass the CMD as args:
#   entrypoint-wrapper.sh rabbitmq-server
# =============================================================================

set -euo pipefail

INIT_SCRIPT="/opt/rabbitmq/init-rabbitmq.sh"

# Start RabbitMQ server in background so we can run init commands
rabbitmq-server "$@" &
RABBITMQ_PID=$!

# Wait for RabbitMQ to be ready (up to 60 seconds)
echo "entrypoint-wrapper: Waiting for RabbitMQ to start..."
for i in $(seq 1 30); do
  if rabbitmqctl status >/dev/null 2>&1; then
    echo "entrypoint-wrapper: RabbitMQ is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "entrypoint-wrapper: WARNING — RabbitMQ did not become ready within 60s, continuing anyway."
  fi
  sleep 2
done

# Run initialization script (if present)
if [ -x "$INIT_SCRIPT" ]; then
  echo "entrypoint-wrapper: Running initialization script..."
  "$INIT_SCRIPT"
  echo "entrypoint-wrapper: Initialization complete."
else
  echo "entrypoint-wrapper: No init script found at $INIT_SCRIPT — skipping."
fi

# Bring RabbitMQ to foreground
echo "entrypoint-wrapper: Handing over to RabbitMQ server (PID $RABBITMQ_PID)."
wait $RABBITMQ_PID
