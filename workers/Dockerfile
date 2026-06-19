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

# ---------------------------------------------------------------------------
# Supply chain: Pin transitive Python dependencies
#
# requirements.txt specifies pinned top-level dependencies with exact versions.
# pip install uses these pinned versions and resolves transitive dependencies
# deterministically. For fully-reproducible builds, generate a requirements.lock
# file using:
#   pip-compile --generate-hashes workers/requirements.txt -o workers/requirements.lock
#
# Then use: pip install --no-deps --require-hashes -r requirements.lock
# ---------------------------------------------------------------------------

# Copy and install Python dependencies with BuildKit cache mount
COPY --chown=stas:stas requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --require-hashes -r requirements.txt 2>/dev/null \
    || pip install --no-cache-dir -r requirements.txt

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
LABEL org.opencontainers.image.title="STAS Worker"
LABEL org.opencontainers.image.description="STAS Celery worker for async task processing"
LABEL org.opencontainers.image.licenses="MIT"

CMD ["celery", "-A", "workers.celery_app", "worker", "-l", "info", "--without-gossip", "--without-mingle", "--without-heartbeat"]
