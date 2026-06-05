# STAS — Solving Tickets As A Service

![CI](https://github.com/tamnguyen08/solving_tickets_as_a_service/actions/workflows/ci.yml/badge.svg)
![CD](https://github.com/tamnguyen08/solving_tickets_as_a_service/actions/workflows/cd.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Label a GitHub issue. Get a pull request.**

STAS is an open-source GitHub bot that takes a labeled issue, investigates your codebase, writes a fix, runs your tests, and opens a PR. Backed by [OpenCode](https://opencode.ai) — the 162K ★ open-source coding agent.

```mermaid
flowchart LR
    A[Label issue with stas:fix] --> B[STAS webhook]
    B --> C[OpenCode agent]
    C --> D[Draft PR with fix + tests]
```

## How It Works

1. Install the GitHub App on your repo
2. Label any issue with `stas:fix`
3. STAS acknowledges, investigates, fixes, verifies
4. A draft PR appears with the fix and regression tests
5. You review and merge

Every fix runs in an isolated sandbox. Your code is never stored. Full audit trail in every PR.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service
npm install

# 2. Start OpenCode (in another terminal)
opencode serve --port 4096

# 3. Configure
cp .env.example .env
# Fill in GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET

# 4. Run
npm run dev
```

## OpenCode Plugin

For development, STAS ships with an OpenCode plugin. Install it to get dev tools:

```json
{
  "plugin": ["@tarquinen/stas-plugin"]
}
```

### Plugin tools

| Tool | Description |
|---|---|
| `stas-dev` | Start local dev environment (opencode serve + bot) |
| `stas-webhook-test` | Simulate a GitHub webhook locally |
| `stas-config` | Validate or init `.env` configuration |
| `stas-status` | Check bot and OpenCode health |

```bash
# Start full dev environment
bash plugin/tools/stas-dev.sh

# Send a test webhook
bash plugin/tools/stas-webhook-test.sh issues.labeled

# Validate config
bash plugin/tools/stas-config.sh check

# Check status
bash plugin/tools/stas-status.sh
```

### OpenCode integration

STAS is built on top of OpenCode. The `WORKFLOW.md` at the project root defines how the OpenCode agent (Sisyphus) autonomously works on tickets — from `Backlog` → `Todo` → `In Progress` → `Human Review` → `Done`, with mandatory anti-mockup scans at every gate.

For OpenCode users: add `@tarquinen/stas-plugin` to your opencode.json `plugin` array, and the agent can invoke dev tools via slash commands during development.

## Self-Hosted vs Cloud

| Feature | Self-Hosted (OSS) | Cloud (Coming Soon) |
|---|---|---|
| Setup | You run it | One-click install |
| AI model | Your API key, your choice | Our AGI (50% better than GPT-5.5) |
| Infrastructure | You manage | We manage |
| Cost | Your API usage | $49/mo flat |
| Limits | Unlimited (your keys) | 100 fixes/mo then usage-based |
| Dashboard | — | Analytics, audit log, config |
| Support | GitHub issues | Slack, email, SLA |

## Architecture

```
GitHub Issue (labeled)
       │
       ▼
   Webhook Server (Express)
       │
       ├── Verify signature
       ├── Post "working on it" comment
       ├── Build prompt from issue context
       │
       ▼
  OpenCode Serve (:4096)
       │
       ├── Clone repo
       ├── Investigate root cause
       ├── Write fix + regression test
       ├── Run test suite
       ├── Commit & push branch
       │
       ▼
  GitHub API
       │
       ├── Open draft PR
       └── Post result comment
```

## Configuration

All config via environment variables:

| Variable | Default | Description |
|---|---|---|
| `GITHUB_APP_ID` | — | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | — | App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | — | Webhook secret |
| `OPENCODE_URL` | `http://localhost:4096` | OpenCode serve endpoint |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Model to use |
| `STAS_LABEL` | `stas:fix` | Issue label to trigger on |
| `STAS_MAX_CONCURRENT` | `3` | Max concurrent fix runs |
| `STAS_PORT` | `3000` | Webhook server port |


## Security

STAS implements defense-in-depth security across multiple layers:

### Webhook Security
- **Signature verification** — All incoming webhooks (GitHub HMAC-SHA256, GitLab token, Bitbucket HMAC-SHA1, Linear HMAC-SHA256, Jira HMAC-SHA256, Stripe) are verified before processing.
- **Rate limiting** — Webhook endpoints are rate-limited (configurable via `STAS_RATE_LIMIT_WINDOW_MS` and `STAS_RATE_LIMIT_MAX`).
- **IP allowlisting** — Optional IP/CIDR allowlist for webhook endpoints (`IP_ALLOWLIST_ENABLED`, `IP_ALLOWLIST`).
- **Request size limits** — Payload size limits prevent DoS attacks: `REQUEST_BODY_LIMIT` (1mb), `WEBHOOK_BODY_LIMIT` (5mb).
- **Raw body capture** — Webhook payloads are captured as raw buffers before JSON parsing to preserve exact byte sequences for signature verification.

### API Security
- **Helmet.js** — HTTP security headers (CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, etc.) on all responses.
- **CORS** — Configurable Cross-Origin Resource Sharing policy via `CORS_ORIGIN`.
- **Admin authentication** — Admin endpoints protected behind `ADMIN_API_KEY` via `Authorization: Bearer` or `x-admin-key` header.
- **Input validation** — All webhook payloads validated with Zod schemas before processing.

### Sandbox Security
- **No privileged mode** — Sandboxes never run with `--privileged` (enforced by `validateSandboxConfig()`)
- **Read-only root filesystem** — Prevents persistent modifications to the sandbox environment.
- **Capability dropping** — All Linux capabilities dropped; only explicitly allowed capabilities added.
- **Resource limits** — CPU (0.5 cores), memory (512MB), disk (2GB), processes (256 PIDs).
- **Network isolation** — Sandbox network access restricted (disabled by default).
- **Internal network denial** — Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16) denied.

### Audit Trail
All admin actions logged to structured audit trail (`src/security/audit.ts`) with action, actor, target, outcome, and timestamp. When `DATABASE_ENABLE_AUDIT_PERSISTENCE=true`, entries persisted to `audit_logs` table.

### CI/CD Security
- **npm audit** — CI runs `npm audit --audit-level=high`, fails on high/critical vulnerabilities.
- **Docker non-root user** — Production image runs as non-root `stas` user with read-only root filesystem.
- **Secret management** — Secrets never baked into images; injected at runtime via environment variables.

### Security Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `ADMIN_API_KEY` | — | Shared API key for admin endpoints |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `REQUEST_BODY_LIMIT` | `1mb` | Max API request body size |
| `WEBHOOK_BODY_LIMIT` | `5mb` | Max webhook payload size |
| `IP_ALLOWLIST_ENABLED` | `false` | Enable IP allowlist for webhooks |
| `IP_ALLOWLIST` | — | Comma-separated IPs/CIDR ranges |
| `SANDBOX_PRIVILEGED` | `false` | Never enable — security violation |
| `SANDBOX_READONLY_ROOT` | `true` | Read-only sandbox filesystem |
| `SANDBOX_MEMORY_LIMIT` | `512m` | Max memory per sandbox |
| `SANDBOX_CPU_LIMIT` | `0.5` | CPU cores per sandbox |
| `SANDBOX_PIDS_LIMIT` | `256` | Max processes per sandbox |
| `SANDBOX_DISK_LIMIT` | `2gb` | Max disk per sandbox |
| `SANDBOX_NETWORK_ENABLED` | `false` | Allow sandbox network access |
| `STAS_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `STAS_RATE_LIMIT_MAX` | `30` | Max requests per window |

## Deployment

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for a comprehensive deployment guide covering local dev, Railway, Fly.io, and Kubernetes.

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/railway.json)

### Railway

```bash
railway login
railway init
railway up
railway secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
```

Railway auto-provisions Redis via the `railway.json` template. Health check at `/health`.

### Fly.io

```bash
fly launch --copy-config
fly secrets set GITHUB_APP_ID=... GITHUB_WEBHOOK_SECRET=...
fly redis create && fly redis attach <name>
fly deploy
```

### Docker

```bash
docker build -t stas-bot .
docker run -p 3000:3000 --env-file .env stas-bot
```

### Docker Compose

#### Development
```bash
# Start Redis + bot with hot-reload
docker compose up
```

#### Production Stack
```bash
# Start full production stack (Redis, RabbitMQ, PostgreSQL, webhook, workers, Nginx)
docker compose -f docker-compose.prod.yml up -d

# Scale workers horizontally (e.g., 4 worker replicas)
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4
```

The production stack includes:
- **PostgreSQL 16** — primary database
- **Redis 7** — Celery result backend + caching
- **RabbitMQ 4** — message broker for Celery
- **stas-webhook** — Express.js API server (horizontally scalable)
- **stas-worker** — Celery worker pool (horizontally scalable via `--scale`)
- **celery-beat** — periodic task scheduler
- **Flower** — Celery monitoring dashboard (port 5555)
- **Nginx** — reverse proxy with TLS termination and load balancing

See `DEVELOPMENT.md` for details on all deployment options.

### Kubernetes

See `k8s/` for example manifests.

## Roadmap

- [x] Webhook receiver & GitHub App integration
- [x] OpenCode agent dispatch
- [x] PR creation with fix
- [x] Two-phase triage (cheap model classifies → expensive model fixes)
- [x] Sandbox isolation (E2B — 10+ language runtimes)
- [x] Regression test verification gate
- [x] Real-time status streaming to issue comments
- [ ] Dashboard for run history
- [ ] Cloud hosted version

## License

MIT — use it, modify it, ship it.
