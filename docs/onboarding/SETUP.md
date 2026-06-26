# Setup Guide

> **Get STAS running in your environment — from zero to your first automated fix.**

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (5 Minutes)](#quick-start-5-minutes)
- [Step-by-Step Setup](#step-by-step-setup)
  - [1. Create a GitHub App](#1-create-a-github-app)
  - [2. Configure Environment](#2-configure-environment)
  - [3. Start the Backend Services](#3-start-the-backend-services)
  - [4. Verify Everything Works](#4-verify-everything-works)
- [Platform-Specific Guides](#platform-specific-guides)
- [Next Steps](#next-steps)

---

## Prerequisites

Before you begin, make sure you have:

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | >= 20.x | LTS recommended |
| **npm** | >= 10.x | Ships with Node.js |
| **Docker** | >= 24.x | Required for sandbox isolation |
| **Redis** | >= 7.x | Queue backend |
| **OpenCode CLI** | Latest | Agent runtime — install via `npm install -g @opencode/cli` |
| **Python** (optional) | >= 3.12 | Only if running Celery workers on bare metal |

Docker Compose is the recommended way to run STAS — it provisions Redis automatically.

---

## Quick Start (5 Minutes)

```bash
# 1. Clone the repository
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service

# 2. Run the automated setup script
npm run setup

# 3. Start OpenCode (agent backend) in a separate terminal
opencode serve --port 4096

# 4. Start the bot
npm run dev

# 5. Verify it's running
curl http://localhost:3000/health
# Expected: {"status":"ok","service":"stas-bot","version":"0.1.0"}
```

> **Note:** The `npm run setup` script handles dependency installation, environment file creation, and database seeding. If you prefer manual control, follow the step-by-step instructions below.

---

## Step-by-Step Setup

### 1. Create a GitHub App

STAS operates as a GitHub App. You need one to receive webhooks and interact with repositories.

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in the required fields:
   - **GitHub App name**: `stas-bot` (or your preference)
   - **Homepage URL**: `https://github.com/tamnguyen08/solving_tickets_as_a_service`
   - **Webhook URL**: `https://your-domain.com/webhook/github` (use a tunneling service like `ngrok` for local dev)
   - **Webhook secret**: Generate a strong secret — save this for `.env`
3. **Permissions** (read & write):
   - `Issues` — read/write
   - `Pull Requests` — write
   - `Contents` — write
   - `Metadata` — read-only
4. **Subscribe to events**:
   - `Issues`
   - `Issue comment`
   - `Pull request`
5. Generate a **private key** (download the `.pem` file) and note the **App ID**

> For a detailed walkthrough with screenshots, see [`docs/SELF_HOSTING.md`](../SELF_HOSTING.md#github-app-creation-walkthrough).

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Required — GitHub App credentials
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Agent backend
OPENCODE_URL=http://localhost:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514

# Optional tweaks
STAS_LABEL=stas:fix
STAS_PORT=3000
STAS_MAX_CONCURRENT=3
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | ✅ | — | GitHub App ID from step 1 |
| `GITHUB_PRIVATE_KEY` | ✅ | — | PEM-encoded private key |
| `GITHUB_WEBHOOK_SECRET` | ✅ | — | Webhook secret from step 1 |
| `OPENCODE_URL` | ✅ | `http://localhost:4096` | OpenCode serve endpoint |
| `OPENCODE_MODEL` | | `anthropic/claude-sonnet-4-20250514` | Primary fix agent model |
| `OPENAI_CHEAP_MODEL` | | `gpt-4o-mini` | Triage model |
| `STAS_LABEL` | | `stas:fix` | Issue label that triggers fixes |
| `STAS_PORT` | | `3000` | Webhook server port |
| `STAS_MAX_CONCURRENT` | | `3` | Max concurrent fix runs |
| `FALLBACK_MODELS` | | — | Comma-separated fallback models |

### 3. Start the Backend Services

#### Option A: Docker Compose (Recommended)

```bash
# Start Redis + bot with hot-reload
docker compose up
```

#### Option B: Bare Metal

```bash
# Terminal 1: OpenCode agent backend
opencode serve --port 4096

# Terminal 2: Webhook server
npm run dev

# Terminal 3: Celery workers (if needed)
cd workers
celery -A celery_app worker --loglevel=info --concurrency=4
```

#### Option C: Production Stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

This starts PostgreSQL, Redis, RabbitMQ, the webhook server, Celery workers, and Nginx.

### 4. Verify Everything Works

```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","service":"stas-bot","version":"0.1.0","uptime":42}

# Check worker status
curl http://localhost:3000/api/health/workers

# Simulate a webhook (using the OpenCode plugin)
bash plugin/tools/stas-webhook-test.sh issues.labeled
```

---

## Platform-Specific Guides

STAS supports multiple Git hosting platforms. See the following guides:

| Platform | Status | Guide |
|---|---|---|
| GitHub | ✅ Live | This guide |
| GitLab | 🧪 Beta | [`docs/platforms/gitlab.md`](../platforms/gitlab.md) |
| Bitbucket | 🧪 Beta | [`docs/platforms/bitbucket.md`](../platforms/bitbucket.md) |
| Linear | 🧪 Beta | [`docs/platforms/linear.md`](../platforms/linear.md) |
| Jira | 🧪 Beta | [`docs/platforms/jira.md`](../platforms/jira.md) |

---

## Next Steps

Once STAS is running:

1. **Install the GitHub App** on a repository you want to auto-fix
2. **Label an issue** with `stas:fix` (or your custom label)
3. **Watch** STAS post a "working on it" comment, then open a draft PR
4. **Review** the PR — STAS includes the fix, regression tests, and an evidence report

For production deployment, see:

- [`docs/SELF_HOSTING.md`](../SELF_HOSTING.md) — comprehensive deployment options
- [`ops/runbook.md`](../ops/runbook.md) — day-2 operations
- [`docs/CUSTOMIZATION.md`](../CUSTOMIZATION.md) — adapting STAS to your workflow
- [`docs/SECURITY.md`](../SECURITY.md) — security model and hardening

For troubleshooting, see [`FAQ.md`](FAQ.md) in this directory.
