# Self-Hosting Guide

> **Everything you need to run SYNTARO on your own infrastructure.**

---

### ⚠️ Self-Host Limitations

Self-hosting SYNTARO is **unlimited** — there are no artificial caps on fixes, repos, or users. However, the self-hosted (OSS) version comes with important caveats:

| Area | Self-Host (OSS) | Cloud Paid ($49–$149/mo) |
|------|-----------------|--------------------------|
| **Dashboard** | ❌ No dashboard — CLI + health endpoints only | ✅ Full analytics, audit log, config UI |
| **Setup** | Manual — you configure GitHub App, Redis, OpenCode, env vars | One-click install |
| **Infrastructure** | You manage — Docker/K8s/Railway, scaling, backups | We manage |
| **Support** | Community via GitHub issues | Slack, email, SLA |
| **Monitoring** | DIY — logs, health checks, Prometheus | Built-in Sentry + alerts |

**Who should self-host?** Developers who want full control, have existing model API keys, and are comfortable operating infrastructure. For everyone else, the [Cloud Free tier](../README.md#business-model) (10 fixes/mo) or a [Paid plan](../STRATEGY.md) may be a better fit.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (5 Minutes)](#quick-start-5-minutes)
- [GitHub App Creation Walkthrough](#github-app-creation-walkthrough)
- [Configuration Walkthrough](#configuration-walkthrough)
- [Running with Docker Compose](#running-with-docker-compose)
- [Running with Docker (Standalone)](#running-with-docker-standalone)
- [Running with Kubernetes](#running-with-kubernetes)
- [Running with Railway](#running-with-railway)
- [Running with Fly.io](#running-with-flyio)
- [Production Checklist](#production-checklist)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

| Requirement | Version | Why |
|---|---|---|
| **Node.js** | >= 20 | Runtime for the bot |
| **Redis** | >= 7 | Job queue (BullMQ), concurrency locks, rate limiting |
| **OpenCode CLI** | Latest | Fix agent backend |
| **Docker** | Latest | Local sandbox (or use E2B cloud) |
| **GitHub App** | — | Webhook receiver + API access |

### Optional

| Tool | Use Case |
|---|---|
| **Docker Compose** | Local development stack |
| **Kubernetes** | Production orchestration |
| **Railway CLI** | One-click deployment |
| **Fly CLI** | Edge deployment |
| **E2B API Key** | Cloud sandbox (no Docker needed) |
| **RabbitMQ** | Alternative queue backend |

---

## Quick Start (5 Minutes)

```bash
# 1. Clone the repository
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service

# 2. Install dependencies
npm install

# 3. Copy and edit configuration
cp .env.example .env

# 4. Create a GitHub App (see walkthrough below)
#    Fill in GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET

# 5. Start Redis + the bot
docker compose up -d

# 6. Start OpenCode (in another terminal)
opencode serve --port 4096

# 7. Verify it's running
curl http://localhost:3000/health
# → {"status":"ok","label":"syntaro:fix","uptime":42,"timestamp":"..."}
```

---

## GitHub App Creation Walkthrough

### Step 1: Create the App

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**
   - Or directly: `https://github.com/settings/apps/new`

2. Fill in the basic info:
   - **GitHub App name**: `syntaro-bot` (or your preferred name)
   - **Homepage URL**: `https://github.com/tamnguyen08/solving_tickets_as_a_service`
   - **Webhook URL**: `https://your-domain.com/webhook` (use `https://smee.io/your-channel` for local dev)
   - **Webhook secret**: Generate a strong random secret:
     ```bash
     openssl rand -hex 32
     ```

### Step 2: Configure Permissions

| Permission | Access | Why |
|---|---|---|
| **Issues** | Read & write | Read issue content, post comments, manage labels |
| **Pull requests** | Read & write | Create PRs with fixes |
| **Contents** | Read & write | Clone repos, push fix branches |
| **Metadata** | Read (automatic) | Repository metadata |

### Step 3: Subscribe to Events

Subscribe to these webhook events:
- **Issues** — Receive `issues.labeled` and `issues.edited` events
- **Issue comments** — Receive comment events (future use)
- **Pull requests** — Receive PR events (future use)

### Step 4: Generate a Private Key

1. Scroll to **Private keys** section
2. Click **Generate a private key**
3. Download the `.pem` file
4. Store it securely:
   ```bash
   mv ~/Downloads/syntaro-bot.*.pem /etc/syntaro/github-private-key.pem
   chmod 600 /etc/syntaro/github-private-key.pem
   ```

### Step 5: Install the App

1. Go to your app settings page (e.g., `https://github.com/settings/apps/syntaro-bot`)
2. Click **Install App** in the sidebar
3. Choose the repositories (or all repositories)
4. Note the **Installation ID** — you can find it in the URL after installation:
   - `https://github.com/settings/installations/12345678`
   - The number at the end is your installation ID

### Step 6: Find Your App ID

Your **App ID** is displayed at the top of your GitHub App settings page. It's a numeric value like `123456`.

---

## Configuration Walkthrough

### Minimal Configuration

Create a `.env` file with these required values:

```bash
# === GitHub App (Required) ===
GITHUB_APP_ID=123456                         # Your GitHub App ID
GITHUB_APP_PRIVATE_KEY_PATH=/etc/syntaro/github-private-key.pem  # Path to PEM file
# OR inline the key (replace \n with actual newlines):
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----"

GITHUB_WEBHOOK_SECRET=your-webhook-secret-here  # Must match GitHub App settings

# === Queue (Default: local Redis) ===
REDIS_URL=redis://localhost:6379

# === OpenCode (Default: local) ===
OPENCODE_URL=http://localhost:4096
```

### Production Configuration

```bash
# === Run Mode ===
RUN_MODE=both                                  # Run API + worker in same process
PORT=3000                                      # Webhook server port
NODE_ENV=production                            # Enable production optimizations

# === GitHub App ===
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/etc/syntaro/github-private-key.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here

# === Queue (Production Redis) ===
REDIS_URL=rediss://username:password@your-redis-host:6380
WORKER_CONCURRENCY=4                           # Increase for more parallelism
QUEUE_DEDUP_TTL_SECONDS=120
QUEUE_MAX_RETRIES=4
QUEUE_RETRY_DELAYS=30000,120000,300000,900000

# === OpenCode ===
OPENCODE_URL=http://opencode:4096              # Docker network URL
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
FALLBACK_MODELS=gpt-4o,claude-haiku
# LLM routing (tier→model/variant) is on by default. See docs/llm-routing-strategy.md.
# PROXY_MODEL_ROUTER_ENABLED=false               # disable difficulty-tier routing

# === Sandbox (Choose one) ===
# E2B (recommended for production):
E2B_API_KEY=e2b_api_key_here
E2B_TEMPLATE_ID=syntaro-default

# Docker (alternative):
# DOCKER_IMAGE=ubuntu:24.04

# === Security ===
ADMIN_API_KEY=your-admin-api-key               # Generate with: openssl rand -hex 32
IP_ALLOWLIST_ENABLED=true
IP_ALLOWLIST=192.30.252.0/22,185.199.108.0/22,140.82.112.0/20
CORS_ORIGIN=https://your-dashboard.com

# === Monitoring ===
LOG_LEVEL=info
SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/0

# === Database (for audit persistence) ===
DATABASE_URL=postgres://user:password@postgres:5432/syntaro
DATABASE_SSL=true

# === Slack Notifications ===
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T0000/B0000/xxxxx
SLACK_CHANNEL=#syntaro-alerts

# === SYNTARO Settings ===
SYNTARO_LABEL=syntaro:fix
BOT_NAME=SYNTARO
MAX_AGENT_ITERATIONS=40
FIX_TIMEOUT_MS=600000                          # 10 minutes
```

### Validating Configuration

SYNTARO validates all environment variables at startup using Zod schemas. If any required values are missing or invalid, you'll see grouped error messages like:

```
Invalid environment configuration:
  GITHUB_APP_ID: GITHUB_APP_ID is required
  GITHUB_WEBHOOK_SECRET: GITHUB_WEBHOOK_SECRET is required
```

Use the config validation tool:
```bash
npm run syntaro:config
# or
bash plugin/tools/syntaro-config.sh check
```

---

## Running with Docker Compose

### Development Stack

```bash
# Start Redis + bot with hot-reload
docker compose up
```

The `docker-compose.yml` starts:
- `syntaro-redis` — Redis 7 (persistent, health-checked)
- `syntaro-bot` — SYNTARO bot with hot-reload via `tsx watch`

### Production Stack

```yaml
# docker-compose.prod.yml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  opencode:
    image: opencodeai/opencode:latest
    ports: ["4096:4096"]
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    command: serve --port 4096

  syntaro-webhook:
    build: .
    ports: ["3000:3000"]
    environment:
      - RUN_MODE=api
      # ... all other env vars
    depends_on: [redis]

  syntaro-worker:
    build: .
    environment:
      - RUN_MODE=worker
      # ... all other env vars
    depends_on: [redis]
    scale: 4  # Scale workers horizontally

  nginx:
    image: nginx:alpine
    ports: ["443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on: [syntaro-webhook]
```

Start the full stack:
```bash
docker compose -f docker-compose.prod.yml up -d

# Scale workers
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=4
```

---

## Running with Docker (Standalone)

```bash
# Build the image
docker build -t syntaro-bot .

# Run with environment file
docker run -p 3000:3000 --env-file .env syntaro-bot

# Run with individual env vars
docker run -p 3000:3000 \
  -e GITHUB_APP_ID=123456 \
  -e GITHUB_WEBHOOK_SECRET=your-secret \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e OPENCODE_URL=http://host.docker.internal:4096 \
  syntaro-bot
```

### Dockerfile Highlights

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

---

## Running with Kubernetes

### Prerequisites

- A Kubernetes cluster (v1.24+)
- `kubectl` configured
- (Optional) Ingress controller for external access

### Basic Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: syntaro-bot
spec:
  replicas: 2
  selector:
    matchLabels:
      app: syntaro-bot
  template:
    metadata:
      labels:
        app: syntaro-bot
    spec:
      containers:
      - name: syntaro-bot
        image: syntaro-bot:latest
        ports:
        - containerPort: 3000
        env:
        - name: GITHUB_APP_ID
          valueFrom:
            secretKeyRef:
              name: syntaro-secrets
              key: github-app-id
        - name: GITHUB_WEBHOOK_SECRET
          valueFrom:
            secretKeyRef:
              name: syntaro-secrets
              key: github-webhook-secret
        - name: REDIS_URL
          value: redis://syntaro-redis:6379
        - name: OPENCODE_URL
          value: http://syntaro-opencode:4096
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: syntaro-bot
spec:
  selector:
    app: syntaro-bot
  ports:
  - port: 3000
    targetPort: 3000
```

### Secrets

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: syntaro-secrets
type: Opaque
stringData:
  github-app-id: "123456"
  github-webhook-secret: "your-webhook-secret"
  github-private-key: |
    -----BEGIN RSA PRIVATE KEY-----
    MIIEpA...
    -----END RSA PRIVATE KEY-----
```

### Redis (using Bitnami Helm chart)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install syntaro-redis bitnami/redis \
  --set auth.enabled=true \
  --set auth.password=syntaro-redis-password \
  --set replica.replicaCount=1
```

### Full Stack with Helm

See `k8s/` directory for complete manifests including:
- `deployment.yaml` — Bot deployment
- `secrets.yaml` — Secret management
- `configmap.yaml` — Non-sensitive configuration
- `hpa.yaml` — Horizontal pod autoscaling
- `ingress.yaml` — Ingress configuration

---

## Running with Railway

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/railway.json)

### Manual Deploy

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and init
railway login
railway init

# Deploy
railway up

# Set secrets
railway secrets set GITHUB_APP_ID=123456
railway secrets set GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
railway secrets set GITHUB_WEBHOOK_SECRET=your-secret
railway secrets set OPENCODE_URL=https://your-opencode-instance.com:4096
```

Railway auto-provisions Redis via the `railway.json` template.

---

## Running with Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Launch
fly launch --copy-config

# Set secrets
fly secrets set GITHUB_APP_ID=123456
fly secrets set GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
fly secrets set GITHUB_WEBHOOK_SECRET=your-secret
fly secrets set OPENCODE_URL=https://your-opencode-instance.com:4096

# Create Redis
fly redis create
fly redis attach <redis-name>

# Deploy
fly deploy

# Scale
fly scale count 2
```

---

## Production Checklist

> 🔧 For ongoing operations after going live (service management, scaling, monitoring, failure recovery), see the [Production Runbook](../ops/runbook.md). For alert-specific response procedures (queue depth, worker failures, backup issues), see the [Alert Playbook](../ops/playbook.md).

### Before Going Live

- [ ] **GitHub App**: Webhook URL is set to your production domain with HTTPS
- [ ] **Webhook secret**: Strong, unique value (use `openssl rand -hex 32`)
- [ ] **Private key**: Stored securely, file permissions `600`
- [ ] **Redis**: Authentication enabled, TLS enabled for external connections
- [ ] **HTTPS**: TLS termination configured at reverse proxy (Nginx, Cloudflare, etc.)
- [ ] **Secrets**: All API keys and tokens are set as environment variables (never in code)
- [ ] **E2B API key**: Configured for production sandbox (or Docker properly secured)
- [ ] **OpenCode**: Running with production model, configured API keys
- [ ] **Health checks**: `/health` endpoint is monitored
- [ ] **Logging**: Structured JSON logging configured
- [ ] **Error monitoring**: Sentry DSN configured
- [ ] **Database**: PostgreSQL configured if using audit persistence
- [ ] **Rate limiting**: Appropriate limits set for your traffic
- [ ] **IP allowlist**: Enabled for webhook endpoints
- [ ] **Backups**: Redis data persistence configured (AOF/RDB)
- [ ] **Monitoring**: Queue depth, error rate, and uptime alerts configured
- [ ] **DNS**: Domain configured with appropriate records

### Regular Maintenance

| Task | Frequency | How |
|---|---|---|
| Update dependencies | Weekly | `npm audit && npm update` |
| Check queue health | Daily | `curl /health` or monitoring dashboard |
| Review DLQ | Weekly | Check dead-letter queue for stuck jobs |
| Rotate secrets | Quarterly | Regenerate webhook secret and API keys |
| Update OpenCode | Monthly | `opencode update` or pull latest Docker image |
| Review logs | Weekly | Check for errors or anomalies |
| Backup config | Monthly | Export env vars and Kubernetes manifests |

---

## Monitoring & Maintenance

### Health Endpoints

```bash
# Basic health
curl http://localhost:3000/health
# → {"status":"ok","label":"syntaro:fix","uptime":3600,"timestamp":"..."}

# Database health
curl http://localhost:3000/health/db
# → {"status":"ok","latencyMs":5,"poolConfig":{"min":2,"max":10,"ssl":false}}
```

### Queue Metrics

```bash
# Via BullMQ API (if exposed)
curl http://localhost:3000/api/v1/admin/queue/metrics
# → {"waiting":3,"active":1,"completed":142,"failed":5,"delayed":0,"paused":false}
```

### Logs

SYNTARO uses **pino** for structured JSON logging:

```bash
# Human-readable output (development)
npm run dev | npx pino-pretty

# Production JSON (ingest by Logstash/Datadog)
docker compose logs -f syntaro-bot
# → {"level":30,"time":1712345678000,"pid":1,"host":"syntaro-bot","module":"server","msg":"SYNTARO server listening on :3000"}
```

Key log modules:
- `server` — HTTP request/response logging
- `webhooks-github` — Webhook event handling
- `issue-queue` — Queue enqueue/dequeue/retry
- `issue-agent` — Agent pipeline phases
- `sandbox-factory` — Sandbox selection
- `sandbox` — E2B sandbox operations
- `docker-sandbox` — Docker sandbox operations
- `action-dispatcher` — PR creation decisions
- `github-auth` — Authentication operations

### Slack Alerts

Configure Slack webhook for alerts:
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T0000/B0000/xxxxx
SLACK_CHANNEL=#syntaro-alerts
```

Alert thresholds (configurable):
- Queue depth warning: 50 messages
- Queue depth critical: 200 messages
- Error rate warning: 10%
- Error rate critical: 30%

### Scaling

### Dashboard

The SYNTARO dashboard (analytics, run history) is served by the same Express server in production:

```bash
# Build the dashboard alongside the API
npm run build:all

# Or build just the dashboard
npm run build:dashboard
```

The dashboard is served automatically when `dashboard/dist/` exists at startup. It handles client-side routing via an SPA fallback: all non-API routes return `index.html`. The Nginx config includes aggressive caching for `/assets/` — deploy new versions with cache-busting hashed filenames (Vite does this automatically).

| Component | Scale Strategy |
|---|---|
| **Webhook API** | Horizontal (multiple pods behind load balancer) |
| **Worker** | Horizontal (set `--scale syntaro-worker=N`) |
| **Redis** | Vertical (more memory) or Redis Cluster |
| **OpenCode** | Dedicated instance per SYNTARO instance |
| **Sandbox** | E2B auto-scales; Docker needs host capacity |
| **Dashboard** | Served by webhook API; scales with it |

---

## Troubleshooting

### Bot not responding to labels

```bash
# 1. Check the webhook arrived
docker compose logs syntaro-bot | grep "Received GitHub webhook"
# 2. Check label matching
docker compose logs syntaro-bot | grep "Ignoring non-target label"
# 3. Check enqueue
docker compose logs syntaro-bot | grep "Issue enqueued"
# 4. Check worker processing
docker compose logs syntaro-bot | grep "Processing issue job"
```

### Redis connection refused

```bash
# Test connection
redis-cli -u redis://localhost:6379 ping

# Check if Redis is running
docker compose ps syntaro-redis

# Check logs
docker compose logs syntaro-redis
```

### OpenCode connection refused

```bash
# Test connection
curl http://localhost:4096/health

# Check if OpenCode is running
opencode serve --port 4096
```

### Sandbox creation failed

```bash
# E2B: Check API key
curl -H "Authorization: Bearer $E2B_API_KEY" https://api.e2b.dev/v1/health

# Docker: Check availability
docker --version
docker info
```
