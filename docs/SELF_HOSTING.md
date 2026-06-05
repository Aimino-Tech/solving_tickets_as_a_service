# Self-Hosting STAS

## Prerequisites

- **Node.js** >= 20
- **Redis** >= 7 (for BullMQ queue)
- **OpenCode** CLI (`npm install -g @opencode/cli`)
- **Docker** (optional, for Docker sandbox)
- **E2B API key** (optional, for cloud sandbox)
- **GitHub App** (see below)

## GitHub App Creation

1. Go to GitHub Settings → Developer settings → GitHub Apps → New GitHub App
2. Fill in:
   - **GitHub App name**: `stas-bot` (or your choice)
   - **Homepage URL**: `https://github.com/your-org/stas-bot`
   - **Webhook URL**: `https://your-server.com/webhook`
   - **Webhook secret**: Generate a secure random string
3. Permissions:
   - **Contents**: Read & write
   - **Issues**: Read & write
   - **Pull requests**: Read & write
   - **Metadata**: Read-only
4. Subscribe to events:
   - Issues
   - Issue comment
   - Pull request
5. Generate a private key and download the PEM file
6. Note your **App ID** from the General tab

## Quick Start (Local)

```bash
# 1. Clone and install
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service
npm install

# 2. Start Redis (if not already running)
redis-server

# 3. Start OpenCode (in another terminal)
opencode serve --port 4096

# 4. Configure environment
cp .env.example .env
# Edit .env with your GitHub App credentials

# 5. Run
npm run dev
```

## Docker Deployment

```bash
# Build the image
docker build -t stas-bot .

# Run with environment file
docker run -p 3000:3000 --env-file .env stas-bot

# Or with Docker Compose (includes Redis)
docker compose up
```

## Docker Compose (Production Stack)

```bash
# Full production stack: Redis, RabbitMQ, PostgreSQL, webhook, workers, Nginx
docker compose -f docker-compose.prod.yml up -d

# Scale workers
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4
```

## Kubernetes Deployment

See `k8s/` directory for example manifests:

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment-webhook.yaml
kubectl apply -f k8s/service-webhook.yaml
kubectl apply -f k8s/deployment-worker.yaml
```

## Railway Deployment

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/railway.json)

```bash
railway login
railway init
railway up
railway secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
```

Railway auto-provisions Redis via the `railway.json` template.

## Fly.io Deployment

```bash
fly launch --copy-config
fly secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
fly redis create && fly redis attach <name>
fly deploy
```

## Configuration

All configuration via environment variables. See `.env.example` for all options.

### Required Variables

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret |
| `GITHUB_APP_PRIVATE_KEY` | App private key (PEM) |
| `REDIS_URL` | Redis connection string |

### Optional Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_URL` | `http://localhost:4096` | OpenCode endpoint |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Agent model |
| `STAS_LABEL` | `stas:fix` | Trigger label |
| `SENTRY_DSN` | — | Sentry error tracking |
| `E2B_API_KEY` | — | E2B cloud sandbox |
| `STAS_PORT` | `3000` | Server port |

## Monitoring

- Health check: `GET /health`
- Database health: `GET /health/db`
- Queue metrics: Exposed via health endpoint
- Prometheus metrics: `GET /metrics` (if enabled)

## Maintenance

- Run history stored in configurable storage (SQLite for OSS, Postgres for hosted)
- Queue cleanup happens automatically based on retention settings
- Dead-letter queues capture failed jobs for manual inspection
- Logs are structured (pino) for integration with log aggregators
