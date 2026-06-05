#!/bin/bash
set -e

# Start healthcheck HTTP server in the background
python /app/workers/health.py &
HEALTH_PID=$!
echo "Healthcheck server started (PID: $HEALTH_PID)"

# Trap SIGTERM and forward to child processes
trap 'echo "Shutting down..."; kill $HEALTH_PID 2>/dev/null; exit 0' SIGTERM SIGINT

# Run the Celery worker (or beat if CMD is overridden)
echo "Starting Celery: $@"
exec "$@"
