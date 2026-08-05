# SYNTARO — Launch-Ready Environment Variables

> **Compiled from `src/config.ts` schema + `.env.example`**
> Last updated: 2026-07-14
> Purpose: Every env var needed for a production launch, with step-by-step sourcing instructions.

---

## Legend

| Mark | Meaning |
|------|---------|
| 🔴 **REQUIRED** | Must be set before the app will start |
| 🟡 Conditional | Required only if the feature is enabled |
| 🟢 Optional | Has a safe default — override for production tuning |

---

## ⚡ Quick Start — Bare Minimum to Boot

Copy-paste this into your `.env` and fill in the values:

```env
LINEAR_API_KEY=lin-api-<your-key>
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/postgres
DATABASE_SSL=true
GITHUB_APP_ID=<numeric-id>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<your-webhook-secret>
NODE_ENV=production
ADMIN_API_KEY=<openssl rand -hex 32>
```

---

## 1. PostgreSQL / Supabase — Database 🔴

**The app requires PostgreSQL. If you don't have one yet, follow this from scratch.**

### Step-by-Step: Create a Supabase Project (from nothing)

1. Go to https://supabase.com and click **Start your project**
2. Sign up with GitHub (easiest) or email
3. Once logged in, click **New project**
4. Fill in:
   - **Name:** `syntaro` (or whatever you like)
   - **Database Password:** Generate a strong one (click the 🔐 icon)
   - **Region:** Pick the closest to your users (e.g., `Frankfurt` for EU, `US East` for US)
   - **Pricing Plan:** Free tier is fine to start (500 MB database)
5. Click **Create new project** — wait ~2 minutes for provisioning

### Get Your Connection String

6. Once the project is ready, go to **Project Settings** (gear icon bottom-left) → **Database**
7. Under **Connection string**, find the **URI** field
8. Click **Copy** — it looks like:
   ```
   postgresql://postgres:<password>@db.<ref>.supabase.co:6543/postgres
   ```
9. Replace `<password>` with the password you set in step 4
10. Set these env vars:

```env
DATABASE_URL=postgresql://postgres:your-password@db.abcdef.supabase.co:6543/postgres
DATABASE_SSL=true
```

### Run Migrations

After setting `DATABASE_URL`, run:

```bash
npx tsx src/db/migrate.ts
# or: npm run db:migrate
```

This applies:

1. **`supabase/migrations/`** — user/commercial schema (users, accounts, credits, billing, teams, OAuth, GDPR), tracked as `supabase/<file>.sql`
2. **`src/db/migrations/`** — ops/pipeline schema (runs, webhooks, analytics, …)

Cloud SaaS: point `DATABASE_URL` (or `SUPABASE_DATABASE_URL`) at your Supabase Postgres URI. Auth uses `SUPABASE_URL` + keys separately; credits/balances live in the same Postgres database.

See [`supabase/migrations/README.md`](../supabase/migrations/README.md) and [`src/db/migrations/README.md`](../src/db/migrations/README.md).

### Connection Pool Settings (Optional Tuning)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_POOL_MIN` | `2` | Min idle connections |
| `DATABASE_POOL_MAX` | `10` | Max connections (Supabase free tier has 15 max) |
| `DATABASE_ENABLE_AUDIT_PERSISTENCE` | `false` | Set to `true` for production audit trail |

---

## 2. Linear — Issue Tracker 🔴

**SYNTARO listens to Linear webhooks for tickets labeled with your trigger label.**

### Step-by-Step: Set Up Linear Integration

#### Get a Linear API Key

1. Go to https://linear.app/settings/api
2. Click **Create key**
3. Give it a name like `syntaro-bot`
4. Copy the generated key (it starts with `lin-api-`)
5. Set:

```env
LINEAR_API_KEY=lin-api-<your-generated-key>
```

#### Set Up a Linear Webhook

1. Go to Linear → **Settings** → **Webhooks** → **Create webhook**
2. Fill in:
   - **URL:** `https://your-syntaro-domain.com/webhook/linear`
   - **Secret:** Generate a random string: `openssl rand -hex 32`
   - **Events:** Select:
     - `Issue` — `create`, `update`
     - `Comment` — `create` (optional, for context)
3. Click **Create**
4. Copy the secret you entered and set:

```env
LINEAR_WEBHOOK_SECRET=<the-secret-you-entered>
```

#### Configure the Trigger Label

SYNTARO picks up Linear issues that have a specific label applied:

```env
SYNTARO_LABEL=syntaro:fix
```

**How it works:**
1. Someone adds the `syntaro:fix` label to a Linear issue
2. Linear sends a webhook to SYNTARO
3. SYNTARO fetches the full issue details via the Linear GraphQL API
4. SYNTARO bridges the ticket to a GitHub issue in the configured repo
5. The agent investigates and opens a PR

---

## 3. GitHub App — Bridge Infrastructure 🟡

**SYNTARO bridges Linear tickets to GitHub issues. A GitHub App is required under the hood even if users interact via Linear.**

### Step-by-Step: Create a GitHub App

1. Go to https://github.com/settings/apps/new
2. Fill in:
   - **GitHub App name:** `syntaro-bot` (must be unique)
   - **Homepage URL:** `https://your-syntaro-domain.com`
   - **Webhook URL:** `https://your-syntaro-domain.com/webhook`
   - **Webhook secret:** Generate: `openssl rand -hex 32`
3. **Permissions** (Repository):
   - Issues: **Read & write**
   - Pull requests: **Write**
   - Contents: **Write**
4. **Subscribe to events:**
   - Issues
   - Issue comments
   - Pull requests
5. **Where can this app be installed?** → `Any account`
6. Click **Create GitHub App**

### Get App Credentials

7. After creation, note the **App ID** on the app settings page:

```env
GITHUB_APP_ID=123456
```

8. Scroll down and click **Generate a private key**
9. A `.pem` file downloads — open it and copy the full content
10. Set the private key inline (replace `\n` literally for newlines):

```env
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----"
```

11. Set the webhook secret you chose in step 2:

```env
GITHUB_WEBHOOK_SECRET=<the-secret-you-entered>
```

### Install the App on Your Repo

12. Go to the app settings page, scroll to **Install App**, click **Install**
13. Select the repos you want SYNTARO to write PRs to
14. Note the **Installation ID** from the URL after installing (`/installations/<ID>`)

```env
TRACKER_INSTALLATION_ID=<numeric-id>
TRACKER_DEFAULT_REPO_OWNER=<your-org>
TRACKER_DEFAULT_REPO_NAME=<your-repo>
```

---

## 4. AI Models / OpenCode 🟡

### OpenCode Serve

SYNTARO requires [OpenCode](https://opencode.ai) running in serve mode:

```bash
# Install
npm install -g @opencode-ai/cli

# Start serve
opencode serve --port 4096
```

```env
OPENCODE_URL=http://localhost:4096
```

### Model Configuration

| Variable | Default | Description | Where to Get It |
|----------|---------|-------------|-----------------|
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Primary model for fixes | Anthropic Console or your LLM provider |
| `FALLBACK_MODELS` | `gpt-4o,claude-haiku` | Fallback models if primary fails | Choose cheaper/faster models |
| `OPENAI_API_KEY` | — | API key for triage/classification | https://platform.openai.com/api-keys |
| `OPENAI_CHEAP_MODEL` | `gpt-4o-mini` | Cheap model for triage | `gpt-4o-mini`, `deepseek-chat`, etc. |

---

## 5. Redis 🟡

**Used for: caching, session store, queue. Get one before deploying.**

### Option A: Upstash (Serverless, Free Tier)

1. Go to https://upstash.com → **Start free**
2. Create a Redis database
3. Copy the `UPSTASH_REDIS_REST_URL`:

```env
REDIS_URL=rediss://default:<password>@<region>.upstash.io:6379
```

### Option B: Railway / Fly.io

Both auto-provision Redis. Connection string available in dashboard.

### Option C: Self-Hosted

```bash
docker run -d --name syntaro-redis -p 6379:6379 redis:7-alpine
```

```env
REDIS_URL=redis://localhost:6379
```

---

## 6. RabbitMQ — Job Queue 🟡

**Required for processing fix jobs.**

### Option A: CloudAMQP (Managed, Free Tier)

1. Go to https://www.cloudamqp.com → **Sign up**
2. Create a **Little Lemur** (free) instance
3. Copy the AMQP URL:

```env
RABBITMQ_URL=amqps://user:password@tiger.rmq.cloudamqp.com/vhost
```

### Option B: Self-Hosted

```bash
docker run -d --name syntaro-rabbitmq -p 5672:5672 rabbitmq:4
```

```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672/syntaro
```

### Queue Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CONCURRENCY` | `2` | Jobs processed concurrently per worker |
| `QUEUE_MAX_RETRIES` | `4` | Max retries before dead-letter |
| `QUEUE_RETRY_DELAYS` | `30000,120000,300000,900000` | Retry backoff in ms |

---

## 7. Stripe / Billing 🟡

**Required only if you accept payments.**

### Step-by-Step: Set Up Stripe

1. Create account at https://stripe.com
2. Go to **Dashboard** → **Developers** → **API keys**
3. Copy the **Secret key** (starts with `sk_live_` or `sk_test_`):

```env
STRIPE_SECRET_KEY=sk_live_<your-key>
```

### Create Products & Prices

4. **Dashboard** → **Products** → **Add product**
5. Create credit packs (one-time):
   - **100 Credits** → $10.00 → copy Price ID (`price_abc123`)
   - **500 + 50 Bonus** → $45.00 → copy Price ID
   - **2000 + 200 Bonus** → $150.00 → copy Price ID
6. Create subscription plans:
   - **Solo** → $49/month → copy Price ID
   - **Team** → $149/month → copy Price ID

```env
STRIPE_PRICE_100_CREDITS=price_abc123
STRIPE_PRICE_500_CREDITS=price_def456
STRIPE_PRICE_2000_CREDITS=price_ghi789
STRIPE_SOLO_PRICE_ID=price_jkl012
STRIPE_TEAM_PRICE_ID=price_mno345
```

### Set Up Webhook

7. **Developers** → **Webhooks** → **Add endpoint**
8. URL: `https://your-syntaro-domain.com/webhook/stripe`
9. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
10. Copy the **Signing secret** (starts with `whsec_`):

```env
STRIPE_WEBHOOK_SECRET=whsec_<your-signing-secret>
```

---

## 8. Monitoring / Alerting 🟡

### Sentry (Error Tracking)

1. Go to https://sentry.io → **Create account**
2. Create a project → choose **Node.js**
3. Copy the DSN:

```env
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Slack (Notifications)

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `SLACK_WEBHOOK_URL` | Simple text notifications | https://api.slack.com/messaging/webhooks → Create webhook |
| `SLACK_BOT_TOKEN` | Interactive messages | https://api.slack.com/apps → Create app → OAuth |
| `SLACK_SIGNING_SECRET` | For interactive requests | Slack App → Basic Information → Signing Secret |

---

## 9. Sandbox / Security 🟡

### E2B Sandbox (Cloud)

Isolated code execution environment:

```env
E2B_API_KEY=e2b_<your-key>
```

1. Go to https://e2b.dev → **Dashboard** → **API Keys**
2. Copy your key

### Docker Sandbox (Self-Hosted)

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_IMAGE` | `node:20-slim` | Base image |
| `DOCKER_NETWORK_RESTRICT` | `true` | Restrict sandbox network |
| `DOCKER_ALLOWED_HOSTS` | `api.github.com,...` | Allowed egress hosts |
| `DOCKER_CONTAINER_MEMORY` | `4g` | Memory per sandbox |
| `DOCKER_CONTAINER_CPU` | `2` | CPU cores per sandbox |

### IP Allowlist

```env
IP_ALLOWLIST_ENABLED=true
IP_ALLOWLIST=192.30.252.0/22,185.199.108.0/22,140.82.112.0/20
```

---

## 10. Core Config 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_AI_MODE` | `ai` | `ai` = real AI, `static` = placeholder mocks for testing |
| `SYNTARO_MODE` | `oss` | `oss` or `hosted` — controls feature gates |
| `SYNTARO_LABEL` | `syntaro:fix` | Issue label that triggers the bot |
| `BOT_NAME` | `SYNTARO` | Bot display name in comments |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `PORT` | `3000` | Webhook server HTTP port |
| `RUN_MODE` | `both` | `api`, `worker`, or `both` |
| `ADMIN_API_KEY` | — | Generate: `openssl rand -hex 32` |
| `CORS_ORIGIN` | `*` | Your dashboard URL in production |
| `STORAGE_TYPE` | `sqlite` | Set to `postgres` for production |
| `DATABASE_SSL` | `false` | **Must be `true`** for Supabase/Railway/Fly.io |

---

## 11. Platform Integrations 🟢

### GitLab

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `GITLAB_URL` | Instance URL (default: `https://gitlab.com`) | Your GitLab instance |
| `GITLAB_TOKEN` | Personal access token with `api` scope | GitLab → Settings → Access Tokens |
| `GITLAB_WEBHOOK_SECRET` | Webhook verification secret | Your choice |

### Bitbucket

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `BITBUCKET_USERNAME` | Account email (API token fallback) | Your Bitbucket/Atlassian account |
| `BITBUCKET_APP_PASSWORD` / `BITBUCKET_API_TOKEN` | API token | Bitbucket / Atlassian API tokens |
| `BITBUCKET_OAUTH_CLIENT_ID` | OAuth client key | Workspace → Settings → OAuth clients |
| `BITBUCKET_OAUTH_CLIENT_SECRET` | OAuth client secret | Workspace → Settings → OAuth clients |
| `BITBUCKET_WEBHOOK_SECRET` | Webhook secret | Your choice |

### Jira (Tracker)

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `JIRA_URL` | Your Jira instance URL | `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | Jira account email | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token | https://id.atlassian.com/manage/api-tokens |
| `JIRA_WEBHOOK_SECRET` | Webhook secret | Your choice |
| `JIRA_PROJECT_KEY` | Default project (e.g., `PROJ`) | Your Jira project key |

---

## 12. Usage / Metering 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_DEFAULT_TIER` | `free` | Default account tier |
| `SYNTARO_MONTHLY_QUOTA_ENABLED` | `true` | Enforce monthly quotas |
| `USAGE_CREDITS_FIX_RUN` | `50` | Credits per fix run |
| `METERING_FREE_MONTHLY_CREDITS` | `100` | Free tier monthly credits |

---

## 13. Optional 🟢

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot for notifications |
| `WHATSAPP_PHONE_NUMBER_ID` | — | WhatsApp Business notifications |
| `MCP_API_KEY` | — | MCP server auth key |
| `RAPIDAPI_PROXY_SECRET` | — | RapidAPI marketplace auth |
| `GITHUB_OAUTH_CLIENT_ID` | — | GitHub OAuth for dashboard login |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | GitHub OAuth secret |
| `CI_MONITOR_ENABLED` | `false` | CI build monitoring |
| `SMEE_URL` | — | smee.io URL for local webhook forwarding |
| `DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY` | `false` | Dev only — skip webhook signature check |

---

## Production Setup Checklist (6 Steps)

### Step 1: Database
```bash
# 1. Go to https://supabase.com → New project (free tier, ~2 min)
# 2. Settings → Database → URI → copy connection string
# 3. Set DATABASE_URL + DATABASE_SSL=true
# 4. Run: npx tsx src/db/migrate.ts
```

### Step 2: Linear
```bash
# 1. https://linear.app/settings/api → Create API key
# 2. Linear → Settings → Webhooks → Create webhook
#    URL: https://your-domain.com/webhook/linear
# 3. Set LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET, SYNTARO_LABEL
```

### Step 3: GitHub
```bash
# 1. https://github.com/settings/apps/new → Create app (Issues R/W, PRs W, Contents W)
# 2. Generate private key → download PEM
# 3. Install app on repos
# 4. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
```

### Step 4: Queue
```bash
# Upstash (free Redis): https://upstash.com
# CloudAMQP (free RabbitMQ): https://www.cloudamqp.com
# Set REDIS_URL, RABBITMQ_URL
```

### Step 5: AI
```bash
npm install -g @opencode-ai/cli
opencode serve --port 4096
# Set OPENCODE_URL=http://localhost:4096
```

### Step 6: Launch
```bash
# Health check
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/health
```
