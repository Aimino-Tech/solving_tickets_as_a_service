FROM python:3.12-slim

WORKDIR /app

RUN addgroup --system syntaro && adduser --system --ingroup syntaro syntaro

# Install system deps for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Django project deps (includes all Celery + worker deps)
COPY syntaro_project/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy Django project and Celery workers
COPY syntaro_project/ ./syntaro_project/
COPY workers/ ./workers/

RUN chown -R syntaro:syntaro /app

USER syntaro

ENV PYTHONPATH=/app/syntaro_project:/app \
    DJANGO_SETTINGS_MODULE=syntaro.settings \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -m celery -A syntaro inspect ping || exit 1

LABEL maintainer="SYNTARO Team"
LABEL description="SYNTARO Celery worker — async task processing"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["celery", "-A", "syntaro", "worker", "-l", "info", "--without-gossip", "--without-mingle", "--without-heartbeat"]
