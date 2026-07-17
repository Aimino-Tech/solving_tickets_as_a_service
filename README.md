# STAS — Solving Tickets As A Service

![CI](https://github.com/tamnguyen08/solving_tickets_as_a_service/actions/workflows/ci.yml/badge.svg)
![CD](https://github.com/tamnguyen08/solving_tickets_as_a_service/actions/workflows/cd.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Benchmark](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/.github/badges/benchmark.svg)
[![RapidAPI](https://img.shields.io/badge/RapidAPI-0055FF?logo=rapidapi&logoColor=white)](https://rapidapi.com/aimino/api/stas-api?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)
[![MCP](https://img.shields.io/badge/MCP_Smithery-000?logo=modelcontextprotocol&logoColor=white)](https://smithery.ai/server/@aimino/stas-mcp?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)
[![OpenCode](https://img.shields.io/badge/OpenCode_Skill-7C3AED?logo=opencode&logoColor=white)](https://opencode.ai/skills/stas?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-2088FF?logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/stas-eval?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)

**Label a GitHub issue. Get a pull request.**

STAS is an open-source GitHub bot that takes a labeled issue, investigates your codebase, writes a fix, runs your tests, and opens a PR. Backed by [OpenCode](https://opencode.ai) — the 162K ★ open-source coding agent.

```mermaid
flowchart LR
    A[Label issue with stas:fix] --> B[STAS webhook]
    B --> C[OpenCode agent]
    C --> D[Draft PR with fix + tests]
```

## AI Agent Discovery

STAS is fully discoverable and installable by AI agents. Agents find STAS via MCP registries, install it autonomously, and start fixing issues — no human required.

```mermaid
flowchart TD
    A[MCP Registry / Smithery / npm / skills.sh] -->|1. Agent discovers| B[AI Agent]
    B -->|2. Installs STAS| C[npx skills add Aimino-Tech/...]
    C -->|3. Fixes issues| D[Draft PR with fix + tests]
    D -->|4. Badge in README| A
```

### One-line install per agent

| Agent | Command / Config |
|---|---|
| **OpenCode** | `npx skills add Aimino-Tech/solving_tickets_as_a_service` |
| **Claude Desktop** | Add to `claude_desktop_config.json`: `{ "mcpServers": { "stas": { "command": "npx", "args": ["-y", "@aimino/stas-mcp"] } } }` |
| **Cursor** | Add to `.cursor/mcp.json`: same as Claude config |
| **Codex CLI** | `npx -y @aimino/stas-mcp` |
| **Any MCP client** | `npx -y @aimino/stas-mcp` |

### Install badges

[![MCP Registry](https://img.shields.io/badge/MCP_Registry-8250DF)](https://github.com/modelcontextprotocol/servers)
[![Smithery](https://img.shields.io/badge/Smithery-000?logo=modelcontextprotocol&logoColor=white)](https://smithery.ai/server/@aimino/stas-mcp)
[![skills.sh](https://img.shields.io/badge/skills.sh-7C3AED)](https://opencode.ai/skills/stas)
[![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@aimino/stas-mcp)
[![Agent Found STAS](https://img.shields.io/badge/Agent_Found-STAS-8250DF)](https://stas.aimino.io/agents.html)

### Add STAS to your agent

```bash
# OpenCode / skills.sh
npx skills add Aimino-Tech/solving_tickets_as_a_service

# Any MCP-compatible agent (npx)
npx -y @aimino/stas-mcp
```

> See [STAS for AI Agents](website/agents.html) and [All Integrations](website/integrations.html) for complete documentation.

## How It Works

1. Install the GitHub App on your repo
2. Label any issue with `stas:fix`
3. STAS acknowledges, investigates, fixes, verifies
4. A draft PR appears with the fix and regression tests
5. You review and merge

Every fix runs in an isolated sandbox. Your code is never stored. Full audit trail in every PR.

## Quick Start

### One-command setup (recommended)

```bash
# Clone and set up everything automatically
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service
npm run setup
```

Then start the bot:

```bash
# Start OpenCode (agent backend, in another terminal)
opencode serve --port 4096

# Start the bot
npm run dev

# Verify it's running
curl http://localhost:3000/health
```

### Manual setup

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

# 4. Seed the database with a demo user (optional, for dashboard testing)
npx tsx src/db/seed.ts

# 5. Run
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

## Business Model

STAS follows an **open-core model** with two paths to paid plans:

| | Self-Hosted (OSS) | Cloud Free | Cloud Paid |
|---|---|---|---|
| **Fixes/mo** | Unlimited | 10 fixes/mo | 100–500+/mo |
| **AI model** | Your API key, your choice | Our AGI (50% better than GPT-5.5) | Our AGI |
| **Setup** | Manual — you run it | One-click install | One-click install |
| **Infrastructure** | You manage | We manage | We manage |
| **Dashboard** | — | Limited analytics | Full analytics, audit log |
| **Support** | GitHub issues (community) | Community | Slack, email, SLA |
| **Cost** | Your API usage | Free | $49–$149/mo |

**Self-host** is unlimited but has caveats: no dashboard, manual setup, community support only. It's ideal for developers who want full control and have their own model API keys.

**Cloud Free** (10 fixes/mo) lets hosted users try STAS risk-free. Both paths point to paid plans ($49/mo Solo, $149/mo Team, custom Enterprise) for full features, higher limits, and support.

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


## RapidAPI Marketplace

STAS is also available as a payable API on the [RapidAPI Marketplace](https://rapidapi.com/).
Subscribe to a plan and get instant access to STAS's fix capabilities without hosting anything yourself.

### Features

- **Fix Submission** — Submit a GitHub issue URL and get a fix PR created automatically
- **Job Polling** — Poll for status and results with a simple job ID
- **Public Eval Results** — See STAS benchmark performance before subscribing
- **Tiered Plans** — Free (10 req/day), Pro (100 req/day), Enterprise (1000 req/day)

### Quickstart

```bash
# 1. Subscribe at RapidAPI Marketplace (link below)
# 2. Get your API key and proxy secret

# 3. Submit a fix job
curl -X POST https://stas-rapidapi.p.rapidapi.com/api/fix \
  -H "Content-Type: application/json" \
  -H "X-RapidAPI-Key: your-rapidapi-key" \
  -H "X-RapidAPI-Proxy-Secret: your-proxy-secret" \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "issueTitle": "Fix login validation bug",
    "issueBody": "The login endpoint returns 500 when the email contains special characters like + or &."
  }'

# 4. Poll for results
curl https://stas-rapidapi.p.rapidapi.com/api/fix/<jobId> \
  -H "X-RapidAPI-Key: your-rapidapi-key" \
  -H "X-RapidAPI-Proxy-Secret: your-proxy-secret"

# 5. Check public eval results (no auth needed)
curl https://stas-rapidapi.p.rapidapi.com/api/eval/results
```

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/fix` | RapidAPI Key + Proxy Secret | Submit a fix job |
| GET | `/api/fix/{jobId}` | RapidAPI Key + Proxy Secret | Poll job status |
| GET | `/api/eval/results` | None | Aggregate eval results |
| GET | `/api/eval/latest` | None | Latest full eval run |
| GET | `/api/health` | None | Service health check |

### Deployment

To deploy your own RapidAPI endpoint:

```bash
# 1. Set RapidAPI env vars
export RAPIDAPI_PROXY_SECRET="your-secret"
export RAPIDAPI_PROVIDER_KEY="your-provider-key"

# 2. Deploy STAS as usual (see Deployment section above)
# 3. Sync OpenAPI spec to RapidAPI
bash scripts/rapidapi-sync.sh
```

## Deployment

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for a comprehensive deployment guide covering local dev, Railway, Fly.io, and Kubernetes.
For day-2 operations (scaling, monitoring, incident response), see the [Production Runbook](ops/runbook.md) and [Alert Playbook](ops/playbook.md).

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


## Documentation

STAS ships with comprehensive documentation:

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Deep-dive into the pipeline: webhooks, queue, agent, sandbox, security |
| [SECURITY.md](docs/SECURITY.md) | Security model: webhook verification, sandbox isolation, prompt injection protection |
| [SELF_HOSTING.md](docs/SELF_HOSTING.md) | Step-by-step self-hosting guide: Docker, Kubernetes, Railway, Fly.io |
| [CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | Customizing labels, models, tools, PR templates, and environment |
| [FAQ.md](docs/FAQ.md) | Frequently asked questions about STAS, alternatives, and troubleshooting |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, testing, PR process, code style |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community guidelines |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local development and deployment guide |
| [ops/runbook.md](ops/runbook.md) | Production deployment runbook — service mgmt, scaling, monitoring, failures |
| [ops/playbook.md](ops/playbook.md) | Alert response playbooks for common incidents |

## Multi-Platform

STAS now supports multiple Git hosting platforms. See the [Platforms documentation](docs/platforms/README.md) for setup guides:

- **GitHub** — Live, fully supported
- **GitLab** — Beta (self-hosted and GitLab.com)
- **Bitbucket** — Beta (Bitbucket Cloud)

Each platform has its own webhook integration, agent pipeline, CI configuration, and eval test strategy. Platform-specific setup guides are in [`docs/platforms/`](docs/platforms/README.md).


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

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, running tests, style guide, and the PR workflow.

## License

MIT — use it, modify it, ship it.
