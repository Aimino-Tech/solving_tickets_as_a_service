# SYNTARO Production Deployment Guide

> **AIM-3204**: Deploying the SYNTARO GitHub webhook server and GitHub App integration to production.

This guide covers deploying the SYNTARO (Solving Tickets As A Service) bot to production. SYNTARO is a GitHub App that automatically investigates, fixes, and opens pull requests for labeled issues.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [GitHub App Setup](#github-app-setup)
- [Environment Configuration](#environment-configuration)
- [Deployment Options](#deployment-options)
  - [Docker Compose (Recommended)](#docker-compose-recommended)
  - [Fly.io](#flyio)
  - [Railway](#railway)
  - [Manual Server](#manual-server)
- [Nginx Reverse Proxy](#nginx-reverse-proxy)
- [Monitoring Setup](#monitoring-setup)
  - [Health Endpoints](#health-endpoints)
  - [Sentry Error Tracking](#sentry-error-tracking)
  - [Prometheus Metrics](#prometheus-metrics)
  - [Slack Alerts](#slack-alerts)
  - [Structured Logging](#structured-logging)
- [Security](#security)
  - [Webhook Signature Verification](#webhook-signature-verification)
  - [Rate Limiting](#rate-limiting)
  - [CORS](#cors)
  - [Helmet Headers](#helmet-headers)
- [Operational Procedures](#operational-procedures)
  - [Deploying Updates](#deploying-updates)
  - [Rolling Back](#rolling-back)
  - [Scaling](#scaling)
  - [Backup and Restore](#backup-and-restore)
  - [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────┐     ┌──────────┐     ┌──────────────────┐
│   GitHub     │────▶│  Nginx   │────▶│  SYNTARO Webhook    │
│   Webhooks   │     │  (TLS)   │     │  (Express)       │
└─────────────┘     └──────────┘     └────────┬─────────┘
                                              │
                    ┌─────────────────────────┤
                    │                         │
                    ▼                         ▼
           ┌───────────────┐        ┌──────────────────┐
           │    Redis       │        │   PostgreSQL     │
           │  (BullMQ)      │        │   (Storage)       │
           └───────────────┘        └──────────────────┘
                    │
                    ▼
           ┌──────────────────┐
           │  OpenCode Serve  │
           │  (AI Agent)       │
           └──────────────────┘
```

### Components

- **Nginx**: TLS termination, rate limiting, reverse proxy, static asset caching
- **SYNTARO Webhook**: Express.js server receiving GitHub webhooks, managing queues
- **Redis**: BullMQ job queue backend for issue processing
- **PostgreSQL**: Persistent storage for accounts, runs, webhook events
- **OpenCode Serve**: AI agent backend that investigates and fixes issues

---

## Prerequisites

### Required Services

1. **GitHub App** — Create one at https://github.com/settings/apps/new
2. **Redis 7+** — For BullMQ job queues
3. **PostgreSQL 16+** — For persistent storage
4. **OpenCode Serve** — AI agent backend
5. **Node.js 20+** — Runtime (if not using Docker)
6. **Docker & Docker Compose** — For containerized deployment

### Required Accounts

- **Sentry** (optional) — Error tracking: https://sentry.io
- **Slack** (optional) — Alert notifications
- **Fly.io** or **Railway** (optional) — Managed hosting

---

## GitHub App Setup

### Using the Manifest (Self-Service)

Users can create their own GitHub App using the manifest template at:

```json
GET /github-app-manifest.json
```

Or use the template at `public/github-app-manifest.json`:

1. Go to https://github.com/settings/apps/new?url=https://your-domain.com/github-app-manifest.json
2. Review and confirm the permissions
3. GitHub creates the app and provides credentials

### Manual Setup

1. Go to https://github.com/settings/apps/new
2. **GitHub App Name**: `SYNTARO - Solving Tickets As A Service`
3. **Homepage URL**: `https://your-domain.com`
4. **Webhook URL**: `https://your-domain.com/webhook`
5. **Webhook secret**: Generate with `openssl rand -hex 32` and save to `GITHUB_WEBHOOK_SECRET`
6. **Permissions**:

   | Permission | Access |
   |------------|--------|
   | Actions | Read-only |
   | Checks | Read & write |
   | Contents | Read & write |
   | Deployments | Read-only |
   | Issues | Read & write |
   | Metadata | Read-only |
   | Pull requests | Read & write |
   | Statuses | Read-only |

7. **Subscribe to events**:
   - Issues
   - Issue comments
   - Pull requests
   - Pull request review
   - Push
   - Check run
   - Check suite
   - Marketplace purchase

8. **Generate a private key** → Download the PEM file
9. **Save the App ID** (numeric) to `GITHUB_APP_ID`

---

## Environment Configuration

### Quick Start

```bash
cp .env.production .env
# Edit .env with your values
```

### Required Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | PEM content of GitHub App private key |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret from GitHub App settings |
| `REDIS_URL` | Redis connection string |
| `OPENCODE_URL` | OpenCode Serve instance URL |
| `SENTRY_DSN` | Sentry DSN (recommended) |
| `ADMIN_API_KEY` | API key for admin endpoints |

### Secrets Management

**Never commit secrets to version control.** Use one of:

- **Docker secrets**: Mount `/run/secrets/` and use file paths
- **Vault**: HashiCorp Vault for dynamic secrets
- **AWS Secrets Manager**: `aws secretsmanager get-secret-value`
- **Doppler**: `doppler run -- node dist/index.js`
- **Fly.io secrets**: `fly secrets set KEY=VALUE`
- **Railway**: Built-in environment variable management

---

## Deployment Options

### Docker Compose (Recommended)

The production stack includes all required services:

```bash
# 1. Configure environment
cp .env.production .env
# Edit .env with your values

# 2. Deploy
docker compose -f docker-compose.prod.yml up -d

# 3. Verify
docker compose -f docker-compose.prod.yml ps
curl http://localhost:3000/health

# 4. Check logs
docker compose -f docker-compose.prod.yml logs -f syntaro-webhook
```

**Scaling workers:**

```bash
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=4
```

**Updating:**

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Fly.io

```bash
# 1. Install flyctl
curl -fsSL https://fly.io/install.sh | sh

# 2. Launch
fly launch --image syntaro-webhook:latest

# 3. Set secrets
fly secrets set GITHUB_APP_ID=...
fly secrets set GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
fly secrets set GITHUB_WEBHOOK_SECRET=...
fly secrets set REDIS_URL=redis://:password@fly-redis.upstash.io:6379
fly secrets set SENTRY_DSN=https://...
fly secrets set ADMIN_API_KEY=...

# 4. Deploy
fly deploy

# 5. Attach Redis (Upstash)
fly redis create
fly redis attach <redis-name>
```

See `fly.toml` for the Fly.io configuration.

### Railway

```bash
# 1. Install Railway CLI
npm i -g @railway/cli

# 2. Login
railway login

# 3. Initialize
railway init

# 4. Set environment variables in Railway dashboard or CLI
railway variables set KEY=VALUE

# 5. Deploy
railway up
```

See `railway.json` for the Railway configuration.

### Manual Server

```bash
# 1. Install dependencies
npm ci --production

# 2. Build
npm run build

# 3. Run with process manager
npm install -g pm2
pm2 start dist/index.js --name syntaro -- -i max

# 4. Set up Nginx (see nginx/syntaro.conf)
# 5. Set up SSL with Let's Encrypt
# 6. Configure systemd service
```

---

## Nginx Reverse Proxy

A production-ready Nginx configuration is provided at `nginx/syntaro.conf`.

### Features

- **TLS termination** with modern ciphers (TLSv1.2 + TLSv1.3)
- **Rate limiting** per IP (30 req/s for webhooks, 100 req/s for API)
- **Security headers** (HSTS, X-Frame-Options, etc.)
- **Structured JSON access logging** for log aggregators
- **Health check** endpoint passthrough
- **Large payload support** for GitHub webhooks (32MB max)
- **OCSP stapling** for certificate status

### Setup

```bash
# For Docker Compose (auto-mounted):
docker compose -f docker-compose.prod.yml up -d nginx

# For manual install:
sudo cp nginx/syntaro.conf /etc/nginx/sites-available/syntaro
sudo ln -s /etc/nginx/sites-available/syntaro /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### SSL Certificates (Let's Encrypt)

```bash
# Initial setup
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d syntaro.your-domain.com

# Auto-renewal (already in docker-compose.prod.yml)
sudo certbot renew --dry-run
```

---

## Monitoring Setup

### Health Endpoints

| Endpoint | Purpose | Frequency |
|----------|---------|-----------|
| `GET /health` | Basic liveness check (Docker, K8s liveness) | Every 30s |
| `GET /health/ready` | Readiness check (K8s readiness, LB health) | Every 30s |
| `GET /health/queue` | Queue depth monitoring | Every 60s |

**Response format** (`GET /health`):

```json
{
  "status": "ok",
  "timestamp": "2026-07-17T12:00:00.000Z",
  "uptime": 3600,
  "version": "0.1.0"
}
```

**Response format** (`GET /health/ready`):

```json
{
  "status": "ok",
  "dependencies": [
    { "name": "database", "status": "ok", "latencyMs": 5 },
    { "name": "redis", "status": "ok", "latencyMs": 2 },
    { "name": "opencode", "status": "ok" },
    { "name": "sentry", "status": "ok" }
  ],
  "timestamp": "2026-07-17T12:00:00.000Z"
}
```

### Sentry Error Tracking

Sentry is configured via environment variables:

```env
SENTRY_DSN=https://xxxxx@xxxxx.ingest.us.sentry.io/xxxxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Features:
- Automatic Express route instrumentation
- Performance tracing (10% sample rate)
- Request body redaction for sensitive fields
- Uncaught exception / unhandled rejection capture

### Prometheus Metrics

Metrics are available at `GET /metrics` in Prometheus text format:

```text
# HELP syntaro_runs_total Total SYNTARO runs
# TYPE syntaro_runs_total counter
syntaro_runs_total{status="completed",repo="owner/repo"} 42
syntaro_runs_total{status="failed",repo="owner/repo"} 3

# HELP queue_depth Current queue depth
# TYPE queue_depth gauge
queue_depth{queue="syntaro-issues",type="bullmq"} 5
```

**Pre-built dashboards** are available in `monitoring/`:
- `grafana-dashboard.json` — General SYNTARO metrics
- `tenant-health-dashboard.json` — Per-tenant health

### Slack Alerts

Configure Slack alerts for operational events:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxxxx
ALERT_SLACK_CHANNEL=#syntaro-alerts
```

Alert rules are defined in `src/monitoring/alerting.ts`:

| Severity | Condition | Action |
|----------|-----------|--------|
| Critical | Queue depth > 200 for 5+ min | Slack + Sentry |
| Warning | Queue depth > 50 for 5+ min | Slack |
| Critical | Error rate > 30% over 5 min | Slack + Sentry |
| Warning | Error rate > 10% over 5 min | Slack |
| Critical | Worker down > 2 min | Slack + Email |
| Warning | Webhook verification failure | Slack |

### Structured Logging

SYNTARO uses Pino for structured JSON logging:

```json
{
  "level": 30,
  "time": 1721234567890,
  "pid": 1,
  "hostname": "syntaro-webhook",
  "module": "server",
  "method": "POST",
  "path": "/webhook",
  "statusCode": 202,
  "latency": 45,
  "requestId": "abc-123",
  "msg": "POST /webhook 202 45ms"
}
```

**Production log aggregation** (pick one):
- **Datadog**: `docker compose` logs → Datadog agent
- **Logz.io**: Filebeat → Logz.io
- **ELK Stack**: Filebeat → Logstash → Elasticsearch → Kibana
- **Grafana Loki**: Promtail → Loki

---

## Security

### Webhook Signature Verification

All incoming webhooks are verified using HMAC-SHA256:

1. **GitHub**: `X-Hub-Signature-256` using `GITHUB_WEBHOOK_SECRET`
2. **GitLab**: `X-Gitlab-Token` using `GITLAB_WEBHOOK_SECRET`
3. **Bitbucket**: `X-Hub-Signature` using `BITBUCKET_WEBHOOK_SECRET`
4. **Linear**: `Linear-Signature` using `LINEAR_WEBHOOK_SECRET`
5. **Jira**: `X-Hub-Signature-256` using `JIRA_WEBHOOK_SECRET`

Verification failures are logged, alerted via Slack, and return HTTP 401.

### Rate Limiting

Three layers of rate limiting protect the service:

1. **Nginx level**: Per-IP rate limits (30 req/s webhook, 100 req/s API)
2. **Application level**: Per-account and per-repo rate limits via `rateLimitMiddleware`
3. **GitHub API level**: Respects GitHub's rate limits with fallback to PAT

### CORS

CORS is configured via `CORS_ORIGIN` environment variable. In production, restrict to your dashboard domain:

```env
CORS_ORIGIN=https://dashboard.your-domain.com
```

### Helmet Headers

Security headers are applied by Helmet middleware:
- Content Security Policy (CSP)
- X-Frame-Options (SAMEORIGIN)
- X-Content-Type-Options (nosniff)
- Strict-Transport-Security (2 years)
- X-DNS-Prefetch-Control (off)
- X-Download-Options (noopen)
- X-Permitted-Cross-Domain-Policies (none)

---

## Operational Procedures

### Deploying Updates

```bash
# Docker Compose
git pull
docker compose -f docker-compose.prod.yml build syntaro-webhook
docker compose -f docker-compose.prod.yml up -d syntaro-webhook

# Fly.io
fly deploy

# Railway
railway up
```

### Health Check Verification

After deployment, verify:

```bash
# Basic health
curl https://syntaro.your-domain.com/health

# Readiness (dependencies)
curl https://syntaro.your-domain.com/health/ready

# Queue health
curl https://syntaro.your-domain.com/health/queue

# Metrics
curl https://syntaro.your-domain.com/metrics
```

### Rolling Back

```bash
# Docker Compose (revert to previous image)
docker compose -f docker-compose.prod.yml stop syntaro-webhook
docker compose -f docker-compose.prod.yml rm syntaro-webhook
docker compose -f docker-compose.prod.yml pull syntaro-webhook
# Or tag specific version:
docker tag syntaro-webhook:previous syntaro-webhook:latest

# Fly.io
fly deploy --image syntaro-webhook:previous

# Railway (dashboard rollback)
railway rollback
```

### Scaling

```bash
# Horizontal scaling (webhook)
docker compose -f docker-compose.prod.yml up -d --scale syntaro-webhook=3

# Horizontal scaling (workers)
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=6

# Vertical scaling (update docker-compose.prod.yml resources)
```

### Database Migrations

```bash
# Run pending migrations
npm run db:migrate

# Rollback last migration
npm run db:migrate:rollback
```

### Backup and Restore

Backups are configured in `docker-compose.prod.yml` via the `syntaro-backup` service:

```bash
# Manual backup
docker exec syntaro-postgres pg_dump -U syntaro syntaro > backup.sql

# Restore
cat backup.sql | docker exec -i syntaro-postgres psql -U syntaro syntaro
```

### Troubleshooting

#### Webhook not received

1. Check GitHub App webhook delivery log:
   - https://github.com/settings/apps → Your App → Advanced
2. Verify webhook URL is accessible:
   ```bash
   curl -v https://syntaro.your-domain.com/webhook
   ```
3. Check Nginx access logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs nginx | grep webhook
   ```

#### Signature verification failed

1. Verify `GITHUB_WEBHOOK_SECRET` matches GitHub App settings
2. Check raw body capture (signature verification requires raw body)
3. Review webhook event log in admin dashboard

#### Queue not processing

1. Check Redis connectivity:
   ```bash
   curl https://syntaro.your-domain.com/health/queue
   ```
2. Check worker logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs syntaro-worker
   ```
3. Verify OpenCode health:
   ```bash
   curl https://syntaro.your-domain.com/health/ready
   ```

#### High memory usage

1. Scale horizontally: `--scale syntaro-webhook=3`
2. Check for memory leaks in Sentry performance traces
3. Review Nginx `client_max_body_size` and `proxy_buffering` settings

---

## References

- [`.env.production`](../.env.production) — Production environment template
- [`nginx/syntaro.conf`](../nginx/syntaro.conf) — Nginx site configuration
- [`docker-compose.prod.yml`](../docker-compose.prod.yml) — Production Docker Compose
- [`fly.toml`](../fly.toml) — Fly.io deployment config
- [`railway.json`](../railway.json) — Railway deployment config
- [`Dockerfile`](../Dockerfile) — Production Docker image
- [`public/github-app-manifest.json`](../public/github-app-manifest.json) — GitHub App manifest
- [`monitoring/`](../monitoring/) — Grafana dashboards and alert configs
- [`src/monitoring/alerting.ts`](../src/monitoring/alerting.ts) — Alert rules
- [`src/monitoring/sentry.ts`](../src/monitoring/sentry.ts) — Sentry configuration
- [`src/server.ts`](../src/server.ts) — Express server with health endpoints
