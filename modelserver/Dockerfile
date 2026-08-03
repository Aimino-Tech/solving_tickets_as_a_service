# =============================================================================
# TabICL Model Server — Multi-stage Docker build
# =============================================================================

# Stage 1: Build / install dependencies
FROM python:3.12-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime
FROM python:3.12-slim AS runtime

RUN addgroup --system modelserver && adduser --system --ingroup modelserver modelserver

WORKDIR /app

COPY --from=build /root/.local /root/.local
COPY server.py .

ENV PATH=/root/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELSERVER_PORT=8090

USER modelserver

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8090/health')" || exit 1

LABEL maintainer="SYNTARO Team"
LABEL description="TabICL Model Server — FastAPI-based inference service"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090"]
