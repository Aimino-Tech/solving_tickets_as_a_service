FROM python:3.12-slim

WORKDIR /app

RUN addgroup --system stas && adduser --system --ingroup stas stas

# Install dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy all source files from the workers build context into /app/workers/
# so the Python module path is workers.celery_app, workers.tasks, etc.
COPY . /app/workers/

RUN chown -R stas:stas /app

USER stas

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD celery -A workers.celery_app inspect ping || exit 1

LABEL maintainer="STAS Team"
LABEL description="STAS Celery worker — async task processing"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

# Default: run Celery worker. Override CMD for celery-beat or other modes.
CMD ["celery", "-A", "workers.celery_app", "worker", "-l", "info", "--without-gossip", "--without-mingle", "--without-heartbeat"]
