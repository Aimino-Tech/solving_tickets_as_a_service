# =============================================================================
# STAS Celery Worker — Python 3.12-based background task processor
#
# Build:
#   docker build -t stas-worker ./workers
#
# Run:
#   docker run --env-file .env stas-worker
# =============================================================================

FROM python:3.12-slim

# ---------------------------------------------------------------------------
# System dependencies
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Working directory
# ---------------------------------------------------------------------------
WORKDIR /app

# ---------------------------------------------------------------------------
# Python dependencies (layer caching — only invalidated when requirements.txt changes)
# ---------------------------------------------------------------------------
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---------------------------------------------------------------------------
# Application code
# ---------------------------------------------------------------------------
COPY celery_app.py .
COPY health.py .
COPY tasks/ ./tasks/

# ---------------------------------------------------------------------------
# Non-root user for security
# ---------------------------------------------------------------------------
RUN addgroup --system --gid 1001 stas && \
    adduser --system --uid 1001 --ingroup stas stas && \
    chown -R stas:stas /app

USER stas

# ---------------------------------------------------------------------------
# Port for health check server
# ---------------------------------------------------------------------------
EXPOSE 8080

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------
LABEL maintainer="STAS Team"
LABEL description="STAS Celery Worker — background task processor for issue triage, sandbox, and PR creation"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 /app/health.py --check

# ---------------------------------------------------------------------------
# Default command (overridden by docker-compose for beat vs worker)
# ---------------------------------------------------------------------------
CMD ["celery", "-A", "celery_app", "worker", "-l", "info", "-Q", "stas.agents.triage,stas.agents.dispatch,stas.agents.sandbox,stas.agents.verification,stas.agents.pr_creation,stas.agents.notifications", "--concurrency=4"]
