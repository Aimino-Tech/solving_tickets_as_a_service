FROM python:3.12-slim

WORKDIR /app

RUN addgroup --system syntaro && adduser --system --ingroup syntaro syntaro

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Django project
COPY syntaro_project/ ./syntaro_project/

# Copy Celery workers (wired via Django celery.py)
COPY workers/ ./workers/

RUN chown -R syntaro:syntaro /app

USER syntaro

ENV PYTHONPATH=/app/syntaro_project:/app \
    DJANGO_SETTINGS_MODULE=syntaro.settings \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python syntaro_project/manage.py check --deploy || exit 1

LABEL maintainer="SYNTARO Team"
LABEL description="SYNTARO Django app — webhook receiver + admin API"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["gunicorn", "syntaro.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4", "--timeout", "120"]
