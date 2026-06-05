FROM python:3.12-slim

WORKDIR /app

RUN addgroup --system stas && adduser --system --ingroup stas stas

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY workers/ ./workers/

RUN chown -R stas:stas /app

USER stas

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python3 /app/workers/health.py --check || exit 1

LABEL maintainer="STAS Team"
LABEL description="STAS Celery worker -- async task processing"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["celery", "-A", "workers.celery_app", "worker", "-l", "info", "--without-gossip", "--without-mingle", "--without-heartbeat"]
