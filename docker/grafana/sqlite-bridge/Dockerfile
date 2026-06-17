# ──────────────────────────────────────────────────────────────────────────────
# Marketing SQLite Bridge — Grafana Simple JSON Datasource Backend
# ──────────────────────────────────────────────────────────────────────────────
# Lightweight Python FastAPI service that reads Hermes marketing SQLite DB
# and exposes it as REST endpoints for Grafana's Simple JSON datasource.
#
# Build:
#   docker build -t hermes-marketing-bridge ./docker/grafana/sqlite-bridge
#
# Run:
#   docker run -d -p 8081:8080 \
#     -v ~/.hermes/marketing:/data/marketing:ro \
#     -e DB_PATH=/data/marketing/campaigns.db \
#     hermes-marketing-bridge
# ──────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

LABEL org.opencontainers.image.title="Hermes Marketing SQLite Bridge"
LABEL org.opencontainers.image.description="Grafana Simple JSON datasource backend for Hermes marketing data"
LABEL org.opencontainers.image.source="https://github.com/NousResearch/hermes-agent"

# Prevent Python from writing .pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --gid 1001 appuser && \
    chown -R appuser:appgroup /app
USER appuser

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

EXPOSE 8080

ENTRYPOINT ["python", "main.py"]
