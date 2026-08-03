# Development & Deployment Guide

## Quick Setup

Get your development environment running with a single command:

```bash
# One-command setup — checks prerequisites, installs dependencies, creates .env
npm run setup

# Validate your environment at any time
npm run doctor
```

The `setup` script will:
1. Check for required tools (Node.js 20+, npm 10+, Python 3.12+, Docker, git)
2. Install Node.js dependencies (`npm install`)
3. Generate a `.env` file with development defaults
4. Optionally start Docker services (Redis, RabbitMQ)
5. Create a Python virtual environment and install worker dependencies
6. Validate GitHub App credentials (if configured)

The `doctor` script validates your full environment:
1. Checks all required tools and their versions
2. Tests service connectivity (Redis, PostgreSQL, RabbitMQ, OpenCode)
3. Validates `.env` configuration
4. Checks for port conflicts
5. Reports system resources (disk, memory)

> **Tip**: Run `npm run doctor` before filing a bug report — it helps diagnose common issues.

---

## Overview


## Overview

SYNTARO can be deployed in several ways depending on your needs:

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

SYNTARO ships with a plugin for OpenCode that provides dev tooling:

```bash
# Start full dev environment
npm run syntaro:dev

# Send a test webhook
npm run syntaro:webhook

# Validate config
npm run syntaro:config

# Check status
npm run syntaro:status
```

### Docker Compose

The `docker-compose.yml` starts:
- `syntaro-redis` — Redis 7 (persistent, healthchecked)
- `syntaro-bot` — the SYNTARO bot with hot-reload

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

### Deploy SYNTARO

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

## Production Deployment (Docker Compose)

The `docker-compose.prod.yml` at the project root provides a full production stack with
persistent storage, TLS termination, monitoring, and automated backups. It is designed
for single-host production deployments and can scale horizontally.

> 🔧 For operations guidance (service management, scaling, monitoring, common failures, upgrades), see the [Production Runbook](ops/runbook.md). For alert response procedures, see the [Alert Playbook](ops/playbook.md).

### Quick Start

```bash
# Start the full production stack
docker compose -f docker-compose.prod.yml up -d

# Scale workers horizontally (e.g., 4 worker replicas)
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=4

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop the stack
docker compose -f docker-compose.prod.yml down
```

### Service Overview

The production stack consists of 12 services, all connected via `syntaro-prod-net` bridge network:

| Service | Container | Image | Purpose |
|---|---|---|---|
| `postgres` | `syntaro-postgres` | `postgres:16-alpine` | Primary database (hosted service) |
| `redis` | `syntaro-redis` | `redis:7-alpine` | Celery backend + BullMQ queue + caching |
| `rabbitmq` | `syntaro-rabbitmq` | `rabbitmq:4-management-alpine` | Message broker for Celery |
| `syntaro-webhook` | `syntaro-webhook` | `syntaro-webhook:latest` | Express.js API server (scalable) |
| `syntaro-worker` | `syntaro-worker` | `syntaro-worker:latest` | Celery worker pool (scalable) |
| `celery-beat` | `syntaro-celery-beat` | `syntaro-worker:latest` | Periodic task scheduler |
| `flower` | `syntaro-flower` | `mher/flower:latest` | Celery monitoring dashboard |
| `nginx` | `syntaro-nginx` | `nginx:alpine` | Reverse proxy with TLS + load balancing |
| `syntaro-dashboard` | `syntaro-dashboard` | `syntaro-dashboard:latest` | React/Vite frontend |
| `certbot` | `syntaro-certbot` | `certbot/certbot:latest` | Let's Encrypt TLS auto-renewal |
| `syntaro-backup` | `syntaro-backup` | `syntaro-webhook:latest` | Scheduled database backups |
| `nginx-setup` | `syntaro-nginx-setup` | `nginx:alpine` | One-time htpasswd generator |

### Core Data Services

#### PostgreSQL 16 (`postgres`)

Persistent SQL database for the hosted service's application data.

- **Image**: `postgres:16-alpine`
- **Port**: `5432` (host) -> `5432` (container)
- **Volume**: `postgres-data` at `/var/lib/postgresql/data`
- **Health check**: `pg_isready -U syntaro -d syntaro` (every 10s)
- **Resource limits**: 256MB memory, 0.2 CPU
- **Restart**: disabled (manual restart via Docker)

Environment variables (via `.env`):

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `syntaro` | Database user |
| `POSTGRES_PASSWORD` | `syntaro-password` | Database password |
| `POSTGRES_DB` | `syntaro` | Database name |

#### Redis 7 (`redis`)

Primary in-memory data store for the Celery result backend, BullMQ job queue, and caching.

- **Image**: `redis:7-alpine`
- **Port**: `6379` (host) -> `6379` (container)
- **Volume**: `redis-data` at `/data`

```yaml
command: redis-server --appendonly yes --appendfsync everysec --auto-aof-rewrite-percentage 100 --auto-aof-rewrite-min-size 64mb
```

The `--appendonly yes` flag enables AOF (Append-Only File) persistence, ensuring
no data loss on restart:
- **`--appendonly yes`** --- enables AOF persistence; every write operation is logged
- **`--appendfsync everysec`** --- fsyncs the AOF once per second; balances durability
  and performance (at most 1 second of data loss on crash)
- **`--auto-aof-rewrite-percentage 100`** --- triggers AOF rewrite when the file grows
  by 100% of the previous size (i.e., doubles)
- **`--auto-aof-rewrite-min-size 64mb`** --- minimum AOF file size before rewrite starts

Redis RDB snapshots are also taken via the `syntaro-backup` service (see [Backups](#backups)).

#### RabbitMQ 4 (`rabbitmq`)

Message broker for Celery workers and cross-service communication between Node.js (webhook server) and Python (Celery workers).

- **Image**: `rabbitmq:4-management-alpine`
- **Ports**: `5672` (AMQP), `15672` (management UI)
- **Volume**: `rabbitmq-data` at `/var/lib/rabbitmq`

Environment variables (via `.env`):

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_USER` | `syntaro-app` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | `syntaro-app-password` | RabbitMQ password |
| `RABBITMQ_VHOST` | `/syntaro` | RabbitMQ virtual host |

### Application Services

#### SYNTARO Webhook (`syntaro-webhook`)

Express.js API server that receives GitHub webhooks and enqueues jobs. Built from
the project root `Dockerfile` with `RUN_MODE=api`.

- **Port**: `3000` (host) -> `3000` (container)
- **Health check**: `GET /health/ready` (every 30s)
- **Graceful shutdown**: 30s timeout for in-flight webhooks
- **Resource limits**: 512MB memory, 0.5 CPU
- **Scalable**: horizontally by adding more replicas

```bash
docker compose -f docker-compose.prod.yml up -d --scale syntaro-webhook=3
```

Nginx load-balances across replicas using `least_conn` strategy (see [Nginx](#nginx)).

#### SYNTARO Worker (`syntaro-worker`)

Celery worker pool that processes job queues. Built from `workers/Dockerfile`.

- **Command**: `celery -A workers.celery_app worker -l info -Q syntaro.agents.* --concurrency=4`
- **Queues**: `syntaro.agents.triage`, `syntaro.agents.dispatch`, `syntaro.agents.sandbox`,
  `syntaro.agents.verification`, `syntaro.agents.pr_creation`, `syntaro.agents.notifications`
- **Graceful shutdown**: 60s timeout for running tasks to complete
- **Resource limits**: 1GB memory, 1 CPU
- **Scalable**: add replicas for more throughput

```bash
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=8
```

#### Celery Beat (`celery-beat`)

Periodic task scheduler that dispatches recurring jobs (health checks, queue depth
monitoring, dead-letter cleanup, backup triggers).

- **Command**: `celery -A workers.celery_app beat -l info`
- **Graceful shutdown**: 15s timeout
- **Single instance**: exactly one replica should run (multi-beat not supported)

#### Flower (`flower`)

Celery monitoring dashboard --- real-time task tracking, worker status, queue depths,
and task history at port `5555`.

- **Image**: `mher/flower:latest`
- **Port**: `5555` (host) -> `5555` (container)
- **Requires**: healthy Redis and RabbitMQ

In production, Flower is accessed through Nginx at the `/flower/` path with
HTTP Basic Authentication. See [Flower Auth](#flower-auth-htpasswd) below.

#### SYNTARO Dashboard (`syntaro-dashboard`)

React/Vite frontend for run history and analytics. Built from `dashboard/Dockerfile`
and served by Nginx on port `5173`.

- **Image**: `syntaro-dashboard:latest` (builds from `./dashboard`)
- **Port**: `5173` (host) -> `80` (container)
- **Health check**: `GET /healthz` (every 30s)
- **Resource limits**: 256MB memory, 0.2 CPU
- **Environment**: `VITE_API_URL=http://syntaro-webhook:3000`

The build is a two-stage Dockerfile:
1. **Builder stage**: `node:20-alpine` compiles the Vite app to `dist/`
2. **Runtime stage**: `nginx:alpine` serves the static build from `/usr/share/nginx/html`

### Infrastructure Services

#### Nginx (`nginx`)

Reverse proxy with TLS termination, rate limiting, security headers, and load balancing
for all web-facing services.

- **Image**: `nginx:alpine`
- **Ports**: `80` (HTTP), `443` (HTTPS)
- **Config**: mounted from `./nginx/nginx.conf` (read-only)
- **SSL certs**: mounted from `./nginx/ssl/` (or certbot-managed, see [Certbot](#certbot))
- **Auth file**: mounted from `htpasswd-data` volume

**Upstream load balancing**:

```nginx
upstream syntaro-webhook-upstream {
    least_conn;
    server syntaro-webhook:3000 max_fails=3 fail_timeout=30s;
}
```

**Rate limiting** --- three zones protect against abuse:

| Zone | Rate | Burst | Endpoints |
|---|---|---|---|
| `webhook_limit` | 30 req/s | 10 | `/webhook` |
| `api_limit` | 100 req/s | 20 | `/api/`, `/`, `/slack/`, `/flower/` |
| `health_limit` | 60 req/min | 5 | `/health`, `/health/ready` |

**Route map**:

| Path | Upstream | Notes |
|---|---|---|
| `/health`, `/health/ready` | `syntaro-webhook-upstream` | Not cached |
| `/webhook` | `syntaro-webhook-upstream` | 32MB body limit, 60s timeout, no buffering |
| `/api/` | `syntaro-webhook-upstream` | 4MB body limit, 30s timeout |
| `/slack/` | `syntaro-webhook-upstream` | Rate-limited |
| `/flower/` | `syntaro-flower:5555` | HTTP Basic Auth required |
| `/assets/` | `syntaro-webhook-upstream` | Aggressively cached (1 year, immutable) |
| `/` (catch-all) | `syntaro-webhook-upstream` | General traffic |

**Security headers** applied to all responses:

```
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
```

#### Certbot (`certbot`)

Automatic TLS certificate provisioning and renewal via Let's Encrypt.

- **Image**: `certbot/certbot:latest`
- **Volumes**: `certbot-www` (webroot challenge), `certbot-etc` (certificates)
- **Depends on**: `nginx` (must be running for HTTP challenge)

**Auto-renewal loop**:

```bash
while :; do
  certbot renew --webroot -w /var/www/html --quiet --non-interactive
  sleep 86400  # 24 hours
done
```

The container runs an infinite loop that:
1. Attempts certificate renewal every 24 hours
2. Uses the `--webroot` authenticator with `/var/www/html` as the webroot
3. Runs non-interactively (`--quiet --non-interactive`)
4. Respects the TERM signal for graceful shutdown (`trap 'exit 0' TERM`)

**Manual initial certificate setup** (first run):

```bash
# Run certbot manually to obtain the initial certificate
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/html \
  -d your-domain.com -d www.your-domain.com \
  --email admin@your-domain.com --agree-tos --non-interactive
```

Certificates are stored in the `certbot-etc` volume and are automatically
renewed by the `certbot` service. Nginx mounts these certificates from
`./nginx/ssl/` (or symlink to the certbot-managed certificates).

> **Note**: For production, update the Nginx config's `ssl_certificate` and
> `ssl_certificate_key` paths in `nginx/nginx.conf` to point to the certbot
> volume paths (e.g., `/etc/letsencrypt/live/your-domain.com/fullchain.pem`
> and `/etc/letsencrypt/live/your-domain.com/privkey.pem`).

#### Flower Auth (`nginx-setup`)

One-time initialization service that generates an htpasswd file for Flower's
HTTP Basic Authentication.

- **Image**: `nginx:alpine`
- **Volume**: `htpasswd-data` at `/etc/nginx`
- **Runs**: once during `docker compose up` and exits

The container installs `apache2-utils` and runs `htpasswd` to create
the credentials file:

```bash
htpasswd -b -c /etc/nginx/.htpasswd '${FLOWER_USER:-admin}' '${FLOWER_PASSWORD:-syntaro-flower-admin}'
```

**Environment variables** (via `.env`):

| Variable | Default | Description |
|---|---|---|
| `FLOWER_USER` | `admin` | Username for Flower dashboard login |
| `FLOWER_PASSWORD` | `syntaro-flower-admin` | Password for Flower dashboard login |

The generated `/etc/nginx/.htpasswd` file is shared with the Nginx container
via the `htpasswd-data` volume. Nginx enforces `auth_basic` on the `/flower/`
location:

```nginx
location /flower/ {
    auth_basic "Celery Monitor";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://syntaro-flower:5555/;
}
```

### Backups

The `syntaro-backup` service runs scheduled backups for all three data stores using
cron jobs inside the container. It reuses the `syntaro-webhook` image (which contains
the backup scripts in `/app/scripts/`).

**Cron schedule**:

| Data Store | Schedule | Command | Retention |
|---|---|---|---|
| PostgreSQL | Every 6 hours (`0 */6 * * *`) | `/app/scripts/backup-postgres.sh` | 30 days (daily) / 7 days (hourly) |
| Redis | Every 12 hours (`0 */12 * * *`) | `/app/scripts/backup-redis.sh` | 30 days (daily) / 7 days (hourly) |
| RabbitMQ | Every 12 hours (`0 */12 * * *`) | `/app/scripts/backup-rabbitmq.sh` | 30 days (daily) / 7 days (hourly) |

**Backup scripts** --- each backup script supports:

| Flag | Description |
|---|---|
| _(none)_ | Daily backup (default, 30-day retention) |
| `--hourly` | Hourly backup prefix (7-day retention) |
| `--dry-run` | Preview what would be done without executing |
| `--restore <file>` | Restore from a specific backup file |

Backup files are stored in the `backup-data` volume at `/backups` and optionally
uploaded to S3-compatible storage when configured.

**Backup environment variables** (via `.env`):

| Variable | Description |
|---|---|
| `BACKUP_DIR` | Local backup directory (default: `/backups`) |
| `BACKUP_S3_BUCKET` | S3 bucket name for off-site backups |
| `BACKUP_S3_ENDPOINT` | S3-compatible endpoint URL |
| `BACKUP_S3_ACCESS_KEY` | S3 access key |
| `BACKUP_S3_SECRET_KEY` | S3 secret key |
| `BACKUP_GPG_PASSPHRASE` | Passphrase for GPG-encrypted backups |
| `BACKUP_RETENTION_DAYS` | Daily backup retention (default: 30 days) |
| `BACKUP_RETENTION_HOURS` | Hourly backup retention (default: 7 days) |

**Backup details by data store**:

- **PostgreSQL**: `pg_dump` with custom format -> gzip -> GPG AES256 encryption ->
  local file + optional S3 upload. Restore via `pg_restore`.
- **Redis**: Triggers `SAVE` -> copies `dump.rdb` -> gzip -> local file + optional
  S3 upload. Restore by replacing the RDB file and restarting Redis.
- **RabbitMQ**: Exports definitions (queues, exchanges, bindings, users, vhosts)
  via management HTTP API -> JSON file -> local file + optional S3 upload.
  Restore via `POST /api/definitions`.

**Restore orchestration** --- use `scripts/restore-all.sh` for a full stack restore:

```bash
# Restore all three data stores from latest backups
./scripts/restore-all.sh

# Dry-run to preview
./scripts/restore-all.sh --dry-run
```

### Resource Profiles

The production stack defines shared resource profiles via YAML anchors:

| Profile | Memory | CPU | Applied To |
|---|---|---|---|
| `resources-webhook` | 512MB | 0.5 | `syntaro-webhook` |
| `resources-worker` | 1GB | 1.0 | `syntaro-worker` |
| `resources-light` | 256MB | 0.2 | All other services |

### Logging

All services use the same JSON-file logging driver:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

Each container is limited to 3 log files of 10MB each (30MB per service).

### Persistent Volumes

| Volume | Mount | Data |
|---|---|---|
| `postgres-data` | `/var/lib/postgresql/data` | PostgreSQL database files |
| `redis-data` | `/data` | Redis AOF + RDB files |
| `rabbitmq-data` | `/var/lib/rabbitmq` | RabbitMQ message store |
| `certbot-www` | `/var/www/html` | Let's Encrypt ACME challenges |
| `certbot-etc` | `/etc/letsencrypt` | TLS certificates + keys |
| `backup-data` | `/backups` | Local backup archives |
| `htpasswd-data` | `/etc/nginx` | Flower htpasswd credentials |

### Health Checks

Each service has a health check appropriate to its role:

| Service | Check | Interval | Start Period | Retries |
|---|---|---|---|---|
| `postgres` | `pg_isready -U syntaro -d syntaro` | 10s | 15s | 5 |
| `redis` | `redis-cli ping` | 5s | 10s | 5 |
| `rabbitmq` | `rabbitmq-diagnostics check_port_connectivity` | 10s | 15s | 5 |
| `syntaro-webhook` | `GET /health/ready` | 30s | 15s | 3 |
| `syntaro-worker` | `python3 /app/workers/health.py --check` | 30s | 30s | 3 |
| `syntaro-dashboard` | `wget --spider http://localhost:80/healthz` | 30s | 15s | 3 |

### Adding Production-Specific Variables to .env

For the production stack, add these variables to your `.env` file:

```bash
# PostgreSQL
POSTGRES_USER=syntaro
POSTGRES_PASSWORD=<generate-a-strong-password>
POSTGRES_DB=syntaro

# RabbitMQ
RABBITMQ_USER=syntaro-app
RABBITMQ_PASSWORD=<generate-a-strong-password>
RABBITMQ_VHOST=/syntaro

# Flower auth
FLOWER_USER=admin
FLOWER_PASSWORD=<generate-a-strong-password>

# Backups (optional --- without S3 config, backups are local-only)
BACKUP_DIR=/backups
BACKUP_GPG_PASSPHRASE=<generate-a-strong-passphrase>
# BACKUP_S3_BUCKET=syntaro-backups
# BACKUP_S3_ENDPOINT=https://s3.amazonaws.com
# BACKUP_S3_ACCESS_KEY=...
# BACKUP_S3_SECRET_KEY=...

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
| `SYNTARO_LABEL` | No | `syntaro:fix` | Trigger issue label |
| `BOT_NAME` | No | `SYNTARO` | Bot display name |
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
GitHub Issue (labeled "syntaro:fix")
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


## Dashboard Deployment

SYNTARO includes a React/Vite dashboard for run history and analytics. In production, the dashboard is built and served by the same Express server.

### Local Development

```bash
# Install dashboard dependencies
cd dashboard && npm install

# Start dashboard dev server (separate terminal, port 5173)
cd dashboard && npm run dev

# The root dev server proxies API requests to :3000
# The Vite dev server runs on :5173 with hot-reload
```

### Production Build

The dashboard is automatically built during the Docker image build (see `Dockerfile`). When running directly:

```bash
# Build the dashboard
npm run build:dashboard

# Build everything (API + dashboard)
npm run build:all
```

### How It Works

1. **Build**: `npm run build:dashboard` compiles the Vite app to `dashboard/dist/`
2. **Serve**: In production (`NODE_ENV=production`), the Express server checks if `dashboard/dist/` exists and serves it as static content
3. **SPA Fallback**: All non-API routes (`/*` that don't start with `/api`, `/health`, `/webhook`, etc.) serve `index.html` — enabling client-side routing
4. **Nginx Caching**: Static assets under `/assets/` are served with aggressive caching headers (`max-age=31536000, immutable`)

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_URL` | (auto) | Override dashboard URL for API proxying in dev |
