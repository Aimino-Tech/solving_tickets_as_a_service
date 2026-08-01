# STAS — Solving Tickets As A Service

![CI](https://github.com/Aimino-Tech/solving_tickets_as_a_service/actions/workflows/ci.yml/badge.svg)
![CD](https://github.com/Aimino-Tech/solving_tickets_as_a_service/actions/workflows/cd.yml/badge.svg)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
![Benchmark](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/.github/badges/benchmark.svg)
[![Product Hunt](https://img.shields.io/badge/Product_Hunt-Product_of_the_Day-FF6154?logo=producthunt&logoColor=white)](https://www.producthunt.com/posts/stas)

[![Discord](https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/aimino)
[![RapidAPI](https://img.shields.io/badge/RapidAPI-0055FF?logo=rapidapi&logoColor=white)](https://rapidapi.com/aimino/api/stas-api?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)
[![MCP](https://img.shields.io/badge/MCP_Smithery-000?logo=modelcontextprotocol&logoColor=white)](https://smithery.ai/server/@aimino/stas-mcp?utm_source=github&utm_medium=readme&utm_campaign=aim-2090)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-8250DF?logo=modelcontextprotocol&logoColor=white)](https://registry.mcp.ai/servers/@aimino/stas-mcp)
[![Smithery](https://img.shields.io/badge/Smithery-000?logo=modelcontextprotocol&logoColor=white)](https://smithery.ai/server/@aimino/stas-mcp)
[![MCP Agent](https://img.shields.io/badge/MCP_Agent-8250DF?logo=modelcontextprotocol&logoColor=white)](https://github.com/Aimino-Tech/solving_tickets_as_a_service)
[![OpenCode](https://img.shields.io/badge/OpenCode_Skill-7C3AED?logo=opencode&logoColor=white)](https://opencode.ai/skills/stas)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-2088FF?logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/stas-eval)
[![Star History](https://api.star-history.com/svg?repos=Aimino-Tech/solving_tickets_as_a_service&type=Date)](https://star-history.com/#Aimino-Tech/solving_tickets_as_a_service&Date)
[![Uptime](https://img.shields.io/badge/Uptime-100%25-brightgreen)](https://stas.betteruptime.com)
[![Status Page](https://img.shields.io/badge/Status_Page-0055FF)](https://stas.betteruptime.com)
[![Demo Repo](https://img.shields.io/badge/Demo-282661?logo=flask&logoColor=white)](https://github.com/Aimino-Tech/stas-demo)

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

> **⭐ If you find STAS useful, [star the repo](https://github.com/Aimino-Tech/solving_tickets_as_a_service) — it helps others discover the project!**

## How It Works

![STAS Demo](dashboard/public/assets/launch/stas-demo.gif)

### Try It Without Installing

Visit **[Aimino-Tech/stas-demo](https://github.com/Aimino-Tech/stas-demo)** — a public Flask + SQLite Todo app with 15+ seeded bugs labeled `stas:fix`. Label any issue and watch STAS create a PR in minutes. No setup required.

```bash
# Quick test: query the demo repo's fixable issues
curl https://api.stas.aimino.io/api/v1/preview \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/Aimino-Tech/stas-demo"}'
```

## Quick Start — First Fix in <15 Minutes

> 📖 For detailed installation instructions covering all deployment options (Cloud, Docker Compose, Kubernetes, Railway/Fly.io), see the [Installation Guide](docs/install/README.md).

Choose your install path:

### GitHub Action (zero config, ~3 minutes)

Add this workflow file to your repo at `.github/workflows/stas.yml`:

```yaml
name: STAS Auto-Fix
on:
  issues:
    types: [labeled]
jobs:
  fix:
    if: github.event.label.name == 'stas:fix'
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: write
      pull-requests: write
    steps:
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.STAS_BOT_APP_ID }}
          private-key: ${{ secrets.STAS_BOT_PRIVATE_KEY }}
      - uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}
          fetch-depth: 0
      - name: Run STAS fix agent
        run: npx -y @aimino/stas-fix-action
        env:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          REPO_OWNER: ${{ github.repository_owner }}
          REPO_NAME: ${{ github.event.repository.name }}
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
```

**3 steps**: Add workflow file → Set 2 secrets (`STAS_BOT_APP_ID`, `STAS_BOT_PRIVATE_KEY`) → Label an issue. Done.

#### Using the STAS GitHub Action directly

The action ships in this repo at `.github/actions/stas-fix/action.yml` (published to the
[GitHub Marketplace](https://github.com/marketplace/actions/stas-fix)). It posts a status
comment, runs the STAS fix agent, and opens a pull request. Reference it with `uses:` —
no `npx` needed:

```yaml
name: STAS Fix
on:
  issues:
    types: [labeled]
jobs:
  fix:
    runs-on: ubuntu-latest
    if: github.event.label.name == 'stas:fix'
    permissions:
      issues: write
      contents: write
      pull-requests: write
    steps:
      - uses: Aimino-Tech/solving_tickets_as_a_service/.github/actions/stas-fix@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Inputs: `github-token` (required), `opencode-url` (default `http://localhost:4096`),
`opencode-api-key`, `opencode-model`, `openai-api-key`, `bot-name` (default `STAS`).
See [MARKETPLACE.md](MARKETPLACE.md) for the full reference and publishing steps.

### Cloud (one-click, ~2 minutes)

Visit [stas.aimino.io](https://stas.aimino.io), install the GitHub App, label an issue. No servers to manage.

### Self-hosted (Docker, ~10 minutes)

```bash
git clone https://github.com/Aimino-Tech/solving_tickets_as_a_service
cd solving_tickets_as_a_service
cp .env.example .env
docker compose up -d
```

### CLI Quickstart (interactive, ~60 seconds)

The `npx stas quickstart` command walks you through the entire setup interactively:

```bash
npx stas quickstart
```

It handles GitHub authentication, app installation, test issue creation, and waits for the fix PR — all in one session.

> 📖 See the [Quickstart CLI Guide](docs/quickstart.md) for detailed walkthrough, non-interactive mode, and troubleshooting.

### Try it without installing anything

```bash
curl -X POST https://api.stas.aimino.io/api/v1/preview \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/owner/repo"}'
```

Returns the top 5 fixable issues in any public repo — no auth required.

## MCP Integration

STAS exposes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that lets any MCP-compatible agent discover and invoke STAS's capabilities — label issues, trigger fix pipelines, check status, and search the codebase.

### MCP Discovery Endpoint

The STAS MCP server is auto-discoverable at:

```
GET /discovery/mcp.json
```

This returns a standard MCP manifest with all available tools, resources, and transport configurations.

### Available Tools

| Tool | Description |
|---|---|
| `stas_label_issue` | Label a GitHub issue with the STAS fix label |
| `stas_run_fix` | Trigger the fix pipeline for a GitHub issue URL |
| `stas_check_status` | Poll fix run status by run_id |
| `stas_get_pr` | Get PR details for a completed fix run |
| `list_issues` | List tracked issues with optional status/repo filters |
| `search_codebase` | Search across tracked fix runs and issues |

### MCP Resources

| Resource URI | Description |
|---|---|
| `stas://runs/{run_id}` | Real-time fix run status and PR link |
| `stas://issues/{issue_id}` | Issue details with fix status and run history |
| `stas://status` | Server health and capability overview |
| `stas://queue` | Current fix queue depth and status |

### Transport Protocols

STAS MCP supports three transport modes:

| Transport | Description | Use Case |
|---|---|---|
| **stdio** | Python subprocess, JSON-RPC over stdin/stdout | OpenCode, Claude Desktop, Cursor |
| **SSE** | Server-Sent Events over HTTP | Remote servers, real-time updates |
| **Streamable HTTP** | HTTP POST with JSON-RPC | Web browsers, REST API clients |

### Installation for AI Tools

#### OpenCode

Add to your `opencode.json`:

```json
{
  "name": "stas-agent-discovery",
  "transport": "stdio",
  "command": "python",
  "args": ["-m", "stas_mcp.server", "stdio"]
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stas": {
      "command": "python",
      "args": ["-m", "stas_mcp.server", "stdio"]
    }
  }
}
```

#### Cursor

Add to Cursor MCP configuration:

```json
{
  "name": "stas-agent-discovery",
  "type": "mcp",
  "command": "python",
  "args": ["-m", "stas_mcp.server", "stdio"]
}
```

### Running the MCP Server

The MCP server auto-starts alongside the main STAS app (controlled by `STAS_MCP_AUTO_START=true`).

To run manually:

```bash
# SSE mode (HTTP, for remote access)
python -m stas_mcp.server sse --port 4095

# stdio mode (for local AI tools)
python -m stas_mcp.server stdio

# With SSL/TLS
python -m stas_mcp.server sse --port 4095 \
  --ssl-keyfile /path/to/key.pem \
  --ssl-certfile /path/to/cert.pem
```

### Quick Test

```bash
# List available tools (stdio mode)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m stas_mcp.server stdio

# Check SSE server is running
curl http://localhost:4095/health
```

### MCP API Keys (per-user authentication)

STAS supports **per-user MCP API keys** so every user (and their agents) authenticates
individually against the MCP surfaces. This is the recommended way to give an AI agent
access to your STAS account.

#### Create a key

1. Open the dashboard **Settings → API Keys** tab (`/settings`).
2. In the **MCP API Keys** card, click **Create key**, give it a name (e.g. `my-agent`).
3. The full key is shown **exactly once** — copy it immediately. Keys start with `sk-stas_`
   and are stored only as a SHA-256 hash server-side, so they can never be recovered later.

#### Use the key in your agent

Keys authenticate **all three MCP surfaces**: the REST tools (`/mcp/*`), the JSON-RPC agent
server (`/mcp/jsonrpc`), and the Python MCP server. The Python server forwards whatever
value is in `STAS_API_KEY` as a `Bearer` token:

```bash
# Python MCP server (stdio/SSE) — point it at your per-user key
STAS_API_KEY=sk-stas_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx python -m stas_mcp.server stdio
```

```json
{
  "mcpServers": {
    "stas": {
      "command": "python",
      "args": ["-m", "stas_mcp.server", "stdio"],
      "env": { "STAS_API_KEY": "sk-stas_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
    }
  }
}
```

For direct HTTP calls:

```bash
curl -X POST http://localhost:4096/mcp/submit_issue \
  -H "Authorization: Bearer sk-stas_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"repoOwner":"owner","repoName":"repo","issueTitle":"Fix the bug"}'
```

#### Manage keys

- **List / rename / revoke** — same Settings → API Keys card. Revocation is immediate
  (soft-delete); revoked keys return `401 Invalid or missing API key`.
- **Legacy env fallback** — the instance-wide `MCP_API_KEY` env var still works when
  `MCP_AUTH_ENABLED=true`. Per-user keys take precedence over the env key.
- **Self-hosted** — if no `MCP_API_KEY` is set and no per-user keys exist, MCP routes
  remain open (same as before).

### MCP Registry Publishing

STAS MCP is published to the [MCP Registry](https://registry.mcp.ai) and [Smithery](https://smithery.ai) for automated agent discovery and one-click deployment.

| Channel | URL | Description |
|---|---|---|
| **MCP Registry** | `https://registry.mcp.ai/servers/@aimino/stas-mcp` | Central MCP server registry |
| **Smithery** | `https://smithery.ai/server/@aimino/stas-mcp` | One-click Docker deployment |

To publish a new version:

```bash
# Tag and push (triggers GitHub Action)
git tag mcp-v1.0.0
git push origin mcp-v1.0.0
```

Or publish manually:

```bash
# Using MCP Registry CLI
npx @mcp/registry-cli publish server.json
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

STAS follows an **open-core model** with three paths, all pointing to paid plans for full features:

| | Self-Hosted (OSS) | Cloud Free | Cloud Paid |
|---|---|---|---|
| **Fixes/mo** | Unlimited | 10 fixes/mo | 100–500+/mo |
| **AI model** | Your API key, your choice | Frontier models (claude-sonnet-4) | Frontier models |
| **Setup** | Manual — you run it | One-click install | One-click install |
| **Infrastructure** | You manage | We manage | We manage |
| **Dashboard** | — | Limited analytics | Full analytics, audit log |
| **Support** | GitHub issues (community) | Community | Slack, email, SLA |
| **Cost** | Your API usage | Free | $49–$199/mo |

**Conversion funnel**: Self-Hosted → Cloud Paid (when infra ops hurt), Cloud Free → Cloud Paid (when 10 fixes/mo isn't enough), Cloud Paid → Enterprise (when team needs SSO, VPC, SLAs).

See [Pricing Model](docs/pricing-model.md) for detailed plan breakdown and economics.

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

### MCP Configuration

| Variable | Default | Description |
|---|---|---|
| `STAS_MCP_AUTO_START` | `true` | Auto-start MCP server with main app |
| `STAS_MCP_SERVER_URL` | `http://localhost:4095` | MCP server public URL |
| `STAS_MCP_PORT` | `4095` | MCP SSE server port |
| `MCP_API_KEY` | — | API key for MCP authentication |
| `MCP_AUTH_ENABLED` | `true` | Enable MCP auth |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | MCP rate limit window |
| `MCP_RATE_LIMIT_MAX` | `60` | Max MCP requests per window |
| `STAS_MCP_SSL_ENABLED` | `false` | Enable SSL for MCP SSE |
| `STAS_MCP_SSL_KEY_PATH` | — | SSL key file path |
| `STAS_MCP_SSL_CERT_PATH` | — | SSL cert file path |


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

### GitHub Marketplace

STAS is listed on [GitHub Marketplace](https://github.com/marketplace/actions/stas-eval). The listing copy, visual asset specs, and submission checklist are in [docs/marketplace-listing.md](docs/marketplace-listing.md).

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
|---|---|---|
| [QUICKSTART.md](docs/quickstart.md) | Interactive CLI walkthrough — get a fix PR in under 60 seconds |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Deep-dive into the pipeline: webhooks, queue, agent, sandbox, security |
| [SECURITY.md](docs/SECURITY.md) | Security model: webhook verification, sandbox isolation, prompt injection protection |
| [SELF_HOSTING.md](docs/SELF_HOSTING.md) | Step-by-step self-hosting guide: Docker, Kubernetes, Railway, Fly.io |
| [CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | Customizing labels, models, tools, PR templates, and environment |
| [FAQ.md](docs/FAQ.md) | Frequently asked questions about STAS, alternatives, and troubleshooting |
| [LAUNCH_PLAYBOOK.md](docs/launch-playbook.md) | Launch strategy playbook — 48-hour multi-channel ignition |
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


## AI Trust & Anti-Slop

The OSS community is rightfully cautious about AI-generated PRs — "slop" (hallucinated changes, phantom files, meaningless noise) erodes trust in automation. STAS is built differently.

### Verified by 6 Quality Gates, not "Generated by AI"

Every STAS PR passes **6 deterministic OSS quality gates** before reaching your reviewers:

| Gate | What It Checks | Tool |
|------|---------------|------|
| **Reality Check** | Every referenced file actually exists | `git ls-files`, `fs.stat` |
| **Compile Check** | `tsc --noEmit` passes | TypeScript compiler |
| **Test Integrity** | Tests have real assertions (no vacuous tests) | vitest + pattern grep |
| **Hallucination Scan** | No TODO stubs, placeholders, fake imports | grep, npm registry scan |
| **Dead Code Check** | No orphaned files or unused exports | knip + ts-prune |
| **MCI Verification** | PR description matches the actual diff (no phantom claims) | Keyword + file-path heuristic scorer |

### Transparency, not opacity

- **AI attribution** — Every PR body clearly states: "This fix was generated by STAS AI."
- **DCO sign-off** — All commits include `Signed-off-by: STAS Bot` for full chain-of-custody.
- **Audit trail** — Every gate result is collapsible in the PR body; raw JSON evidence is persisted.
- **PR-MCI scoring** — A message-code inconsistency score (0–100) tells you if the description actually matches the diff.

### Our commitment

We do not ship "probably fine." If any gate fails, the PR is **blocked** — no exception, no skip flag. The agent retries up to 3 times before escalating to a human.

> "The best AI-generated PR is one you can trust without re-reading everything."

## Roadmap

- [x] Webhook receiver & GitHub App integration
- [x] OpenCode agent dispatch
- [x] PR creation with fix
- [x] Two-phase triage (cheap model classifies → expensive model fixes)
- [x] Sandbox isolation (E2B — 10+ language runtimes)
- [x] Regression test verification gate
- [x] Real-time status streaming to issue comments
- [x] MCP agent discovery & publishing
- [ ] Dashboard for run history
- [ ] Cloud hosted version

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, running tests, style guide, and the PR workflow.

## License

Released under the GNU Affero General Public License v3.0 (AGPL-3.0) — use it, modify it, ship it. See [`LICENSE`](LICENSE) for the full terms.

## Agent Skill Ecosystem

STAS is published as a skill for multiple agent platforms. Install it in your preferred coding assistant.

### OpenCode

Add to `opencode.json` (project root or `~/.config/opencode/opencode.json`):

```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "stas_mcp.server", "stdio"]
    }
  }
}
```

Or use the install script:
```bash
# From the project root
bash stas_mcp/install.sh --opencode

# Or via npm
npx stas install-mcp --opencode
```

### Claude Code

Add to `claude_desktop_config.json` (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "stas_mcp.server", "stdio"]
    }
  }
}
```

Or use the install script:
```bash
npx stas install-mcp --claude
```

### Cursor

1. Open **Cursor Settings → Features → MCP Servers**
2. Click **+ Add New MCP Server**
3. Fill in:
   - **Name:** `stas`
   - **Type:** `command`
   - **Command:** `python3 -m stas_mcp.server stdio`
4. Click **Save**

Or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "stas_mcp.server", "stdio"]
    }
  }
}
```

### Codex CLI

Add to `.codex/config.json` in your project root:

```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "stas_mcp.server", "stdio"]
    }
  }
}
```

### Claude Plugin Marketplace

STAS is listed in the [Claude Plugin Marketplace](.claude-plugin/marketplace.json) with full skill definitions at `skills/stas/SKILL.md`.

### Publishing Channels

| Channel | Location |
|---------|----------|
| **skills.sh** | `skills/stas/SKILL.md` |
| **Claude Plugin Marketplace** | `.claude-plugin/marketplace.json` |
| **npm** | `npx stas install-mcp` — one-command install for all agents |
| **Smithery** | `@aimino/stas-mcp` — hosted MCP server |
| **GitHub Marketplace** | GitHub Action for STAS eval |
| **RapidAPI** | Payable STAS API endpoint |

### Verify Installation

After installing the skill, verify the MCP server responds:

```bash
# List available tools via stdio
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m stas_mcp.server stdio

# Or start SSE mode and curl health
python -m stas_mcp.server sse &
curl http://localhost:4095/health
```
