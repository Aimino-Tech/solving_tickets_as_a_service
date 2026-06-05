# Development & Deployment Guide

## Overview

STAS can be deployed in several ways depending on your needs:

- **Local development** — Docker Compose with Redis + hot-reload
- **Railway** — one-click deploy with managed Redis
- **Fly.io** — global edge deployment with Upstash Redis
- **Kubernetes** — for self-hosted production (see `k8s/`)

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for local dev)
- A GitHub App (see `.env.example` for setup)
- OpenCode CLI (`npm install -g @opencode/cli`)

## Local Development

### Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your GitHub App credentials

# 3. Start Redis + bot (in one terminal)
docker compose up

# 4. Start OpenCode (in another terminal)
opencode serve --port 4096
```

The bot starts on `http://localhost:3000`. Health check: `GET /health`.

### npm scripts

| Script | Description |
|---|---|
| `npm run dev` | Start bot with hot-reload (both API + worker) |
| `npm run dev:api` | Start API server only |
| `npm run dev:worker` | Start worker only |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled bot |
| `npm test` | Run test suite |
| `npm run smee` | Start smee.io webhook proxy |

### OpenCode plugin

STAS ships with a plugin for OpenCode that provides dev tooling:

```bash
# Start full dev environment
npm run stas:dev

# Send a test webhook
npm run stas:webhook

# Validate config
npm run stas:config

# Check status
npm run stas:status
```

### Docker Compose

The `docker-compose.yml` starts:
- `stas-redis` — Redis 7 (persistent, healthchecked)
- `stas-bot` — the STAS bot with hot-reload

```bash
# Start everything
docker compose up

# Rebuild after dependency changes
docker compose up --build

# Run in background
docker compose up -d
```

## Railway

### One-click deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/railway.json)

> **Note**: The button above links to the template in this repo. For a permanent template, publish it to [Railway Templates](https://railway.app/templates).

### Manual deploy

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway init

# Deploy
railway up

# Set secrets (required)
railway secrets set GITHUB_APP_ID=<your-app-id>
railway secrets set GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
railway secrets set GITHUB_WEBHOOK_SECRET=<your-webhook-secret>
railway secrets set OPENCODE_URL=https://your-opencode-instance.com:4096
```

### Template details

The `railway.json` at the project root defines:

- **Build**: Uses the existing `Dockerfile`
- **Deploy**: Single replica, health check at `/health`
- **Plugins**: Redis (auto-provisioned, `REDIS_URL` injected automatically)
- **Env vars**: Pre-configured with production defaults; secrets must be set manually

## Fly.io

### Prerequisites

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login
```

### Deploy STAS

```bash
# Launch the app (creates fly.toml if it doesn't exist)
fly launch --copy-config

# Set environment secrets
fly secrets set GITHUB_APP_ID=<your-app-id>
fly secrets set GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
fly secrets set GITHUB_WEBHOOK_SECRET=<your-webhook-secret>
fly secrets set OPENCODE_URL=https://your-opencode-instance.com:4096

# Deploy
fly deploy
```

### Set up Redis (Upstash)

```bash
# Create a Redis instance
fly redis create

# Attach to your app (injects REDIS_URL as a secret)
fly redis attach <redis-name>
```

### Scale

```bash
# Scale to 2 machines
fly scale count 2

# See logs
fly logs

# SSH into a machine
fly ssh console
```

### Config details

The `fly.toml` at the project root configures:

- **Port**: Internal 3000, external HTTPS (auto TLS)
- **Health check**: `GET /health` every 30s
- **Concurrency**: 10 soft / 25 hard limit per machine
- **Auto-scaling**: Machines start on request, never stop (idle shutdown disabled)

## Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | — | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes* | — | GitHub App private key (PEM) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Yes* | — | Path to private key PEM file |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | Webhook verification secret |
| `GITHUB_WEBHOOK_PATH` | No | `/webhook` | Webhook endpoint path |
| `OPENCODE_URL` | Yes | `http://localhost:4096` | OpenCode serve endpoint |
| `OPENCODE_MODEL` | No | `anthropic/claude-sonnet-4-20250514` | Agent model |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment name |
| `RUN_MODE` | No | `both` | `api`, `worker`, or `both` |
| `LOG_LEVEL` | No | `info` | Log verbosity |
| `STAS_LABEL` | No | `stas:fix` | Trigger issue label |
| `BOT_NAME` | No | `STAS` | Bot display name |
| `MAX_AGENT_ITERATIONS` | No | `40` | Max agent tool calls |
| `MAX_ISSUE_COMMENTS` | No | `15` | Max issue comments per run |
| `E2B_API_KEY` | No | — | E2B sandbox API key |
| `WORKER_CONCURRENCY` | No | `2` | Parallel job processing |
| `QUEUE_DEDUP_TTL_SECONDS` | No | `120` | Dedup window for issues |
| `QUEUE_KEEP_COMPLETED` | No | `200` | Retain completed jobs |
| `QUEUE_KEEP_FAILED` | No | `100` | Retain failed jobs |

\* Either `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH` is required.

## Architecture Notes

```
GitHub Issue (labeled "stas:fix")
       │
       ▼
  Webhook Server (Express, :3000)
       │
       ├── Verify signature
       ├── Post "working on it" comment
       ├── Enqueue job (BullMQ + Redis)
       │
       ▼
  Worker (processes queue)
       │
       ├── Build prompt from issue context
       ├── Dispatch to OpenCode serve (:4096)
       │
       ▼
  OpenCode Agent
       │
       ├── Clone repo (shallow)
       ├── Investigate, fix, test
       ├── Commit & push branch
       │
       ▼
  GitHub API
       │
       ├── Open draft PR
       └── Post result comment
```

The bot consists of two processes (API server + worker) that communicate via Redis:

- **API server** receives webhooks and enqueues jobs
- **Worker** processes jobs by dispatching them to OpenCode

In production, you can run both in a single container (`RUN_MODE=both`) or scale them independently (`RUN_MODE=api` / `RUN_MODE=worker`).
