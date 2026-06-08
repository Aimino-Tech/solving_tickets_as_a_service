FROM python:3.12-slim

# Security: upgrade all system packages to fix known CVEs
RUN apt-get update && apt-get upgrade -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# SHELL hardening: ensure pipefail is set for all RUN commands
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Create non-root user for security
RUN addgroup --system stas && adduser --system --ingroup stas stas

WORKDIR /app

# Copy and install Python dependencies with BuildKit cache mount
COPY --chown=stas:stas requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Copy application code with correct ownership
COPY --chown=stas:stas workers/ ./workers/

USER stas

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Healthcheck — pings Celery to verify worker responsiveness
# Interval: how often to check (30s)
# Timeout: max time for a single check (10s)
# Start-period: grace period for worker startup (15s)
# Retries: consecutive failures before marking unhealthy (3)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD celery -A workers.celery_app app inspect ping || exit 1

LABEL maintainer="STAS Team"
LABEL description="STAS Celery worker — async task processing"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["celery", "-A", "workers.celery_app", "worker", "-l", "info", "--without-gossip", "--without-mingle", "--without-heartbeat"]
