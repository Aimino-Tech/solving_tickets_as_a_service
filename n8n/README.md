# n8n Workflows for STAS / OpenSymphony

This directory contains n8n workflow JSON exports for integrating external services.

## Architecture

```
Service (Crisp, GitHub, OS) → POST /webhook/{id} → n8n workflow → action (Slack, email, etc.)
```

n8n runs as a Docker container alongside STAS, sharing the `postgres` database and `stas-net` network. Workflows are created via the n8n REST API (`POST /rest/workflows`) and can be activated/deactivated programmatically.

**Setup:**
1. `docker compose up -d n8n` — starts n8n on port 5678
2. Set `N8N_DB_PASSWORD` and `N8N_ENCRYPTION_KEY` in `.env`
3. Authorize services (Slack, Crisp, etc.) in n8n UI at `http://localhost:5678`
4. Deploy workflows: `bash n8n/deploy-workflow.sh n8n/workflows/<name>.json`

## Workflows

### 1. Slack Alerts — OS Events → #syntaro-alerts

**File:** `workflows/slack-alerts.json`

Receives webhook events from OpenSymphony and posts formatted alerts to the `#syntaro-alerts` Slack channel.

**Events handled:**

| Event Type | Color | Description |
|------------|-------|-------------|
| `ticket_dispatched` | Blue (`#3498DB`) | A ticket has been assigned to an agent |
| `agent_completed` | Green (`#2ECC71`) | An agent finished processing a ticket |
| `quality_gate_failed` | Red (`#E74C3C`) | A quality gate check failed |
| Unknown | Gray | Fallback for unhandled event types |

**Setup:**

1. Open your n8n instance
2. Go to **Workflows** → **Import from File** → Select `workflows/slack-alerts.json`
3. Configure the **Slack** node:
   - Create a Slack app with `chat:write` scope
   - Install the app to the `#syntaro-alerts` channel
   - Set the OAuth token in n8n credentials
4. Note the webhook URL n8n provides (e.g., `https://<your-n8n>/webhook/os-event`)
5. Configure OpenSymphony to POST events to this URL:

   ```env
   N8N_SLACK_WEBHOOK_URL=https://<your-n8n>/webhook/os-event
   ```

**Expected webhook payload:**

```json
{
  "event_type": "ticket_dispatched",
  "issue_title": "Fix login bug",
  "issue_url": "https://github.com/org/repo/issues/42",
  "repo": "org/repo",
  "agent": "stas-agent"
}
```

### 2. Crisp AI Support Bot (AIM-3333)

**File:** `workflows/crisp-support-bot.json`

Handles Crisp chat messages with vector search + LLM response.

**Flow:**

```
Crisp webhook (user message) → n8n HTTP endpoint
  → Extract message content
  → Vector search (docs) → build context
  → If docs found: LLM node (OpenAI GPT-4o-mini) → reply in Crisp
  → If docs not found: fallback message + create ticket in OS
```

**Setup:**

1. Sign up for n8n Cloud ($20/mo) or self-host
2. Add the Crisp free tier website widget to your site
3. Import `workflows/crisp-support-bot.json` into n8n
4. Configure credentials:

   | Credential | Description |
   |------------|-------------|
   | **Crisp API** | API keys from Crisp settings → API → Generate keys |
   | **OpenAI** | API key with access to gpt-4o-mini |
   | **Vector Search** | HTTP header auth for vector service endpoint |

5. Set environment variables in n8n:

   ```env
   VECTOR_SEARCH_URL=http://vector-service:8000/search
   OS_API_URL=http://opensymphony:4000/api/v1/dispatch
   ```

6. Configure the Crisp webhook to point to your n8n webhook URL:
   ```
   https://<your-n8n>/webhook/crisp-message
   ```

**Behavior:**

| Scenario | Response |
|----------|----------|
| Docs cover the question | LLM generates answer from context → posted to Crisp |
| Docs don't cover the question | Bot says "I'll forward this to the team" → creates OS ticket |

### 3. Deploy Notifications — GitHub Actions → Discord (AIM-3342)

**File:** `workflows/deploy-discord.json`

Receives GitHub Actions `workflow_run.completed` events and posts success notifications to a Discord channel.

**Flow:**

```
GitHub Actions webhook (workflow_run.completed)
  → Condition (conclusion == success)
  → Discord embed (repo, branch, commit, who triggered)
```

**Setup:**

1. Open your n8n instance
2. Go to **Workflows** → **Import from File** → Select `workflows/deploy-discord.json`
3. Create a Discord webhook in your server:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Select the `#deploys` channel
   - Copy the webhook URL
4. Set the Discord webhook URL as an environment variable in n8n:

   ```env
   DISCORD_DEPLOY_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```

5. Configure GitHub to send `workflow_run` events to your n8n webhook URL:
   ```
   https://<your-n8n>/webhook/deploy-event
   ```

**Expected webhook payload (GitHub Actions workflow_run.completed):**

```json
{
  "action": "completed",
  "workflow_run": {
    "name": "Deploy to Production",
    "head_branch": "main",
    "conclusion": "success",
    "head_commit": { "id": "abc123def456" },
    "html_url": "https://github.com/org/repo/actions/runs/123"
  },
  "repository": { "full_name": "org/repo" },
  "sender": { "login": "username" }
}
```

**Behavior:**

| Scenario | Response |
|----------|----------|
| Deploy succeeds | Green embed posted to Discord with repo, branch, commit, actor |
| Deploy fails or is cancelled | Workflow exits silently (no message) |

### 4. Telegram Notifications — OS Progress → Telegram Bot (AIM-3339)

**File:** `workflows/telegram-notifications.json`

Receives progress update messages from the STAS Telegram channel and sends them to users via n8n's built-in Telegram node. Replaces the direct `telegram.sendMessage` calls in `src/channels/telegram.ts`.

**Flow:**

```
OS progress update → POST /webhook/telegram-notification → n8n
  → Format message payload
  → Telegram node (sendMessage)
```

**Setup:**

1. Import `workflows/telegram-notifications.json` into n8n
2. Configure the **Telegram** credentials:
   - Create a Telegram Bot via [@BotFather](https://t.me/BotFather)
   - Copy the bot token
   - Set it in n8n as a **Telegram API** credential
3. Note the webhook URL:
   ```
   https://<your-n8n>/webhook/telegram-notification
   ```
4. Set environment variable in STAS:
   ```env
   N8N_TELEGRAM_WEBHOOK_URL=https://<your-n8n>/webhook/telegram-notification
   ```

**Expected webhook payload:**

```json
{
  "chat_id": "123456789",
  "text": ":mag: *Investigating* — Run `run-abc123`",
  "parse_mode": "Markdown",
  "disable_web_page_preview": true
}
```

**Behavior:**

| Scenario | Response |
|----------|----------|
| Valid payload received | Message sent to the specified Telegram chat |
| Missing chat_id or text | Telegram node returns error (logged by n8n) |

### 5. WhatsApp Notifications — OS Progress → WhatsApp (AIM-3339)

**File:** `workflows/whatsapp-notifications.json`

Receives progress update messages from the STAS WhatsApp channel and sends them to users via n8n's built-in WhatsApp Business node. Replaces the direct WhatsApp Cloud API calls in `src/channels/whatsapp.ts`.

**Flow:**

```
OS progress update → POST /webhook/whatsapp-notification → n8n
  → Format message payload
  → WhatsApp Business node (send message)
```

**Setup:**

1. Import `workflows/whatsapp-notifications.json` into n8n
2. Configure the **WhatsApp Business** credentials:
   - Set up a WhatsApp Business Account in Meta Developer Portal
   - Configure a WhatsApp Business phone number
   - Set the credentials in n8n
3. Note the webhook URL:
   ```
   https://<your-n8n>/webhook/whatsapp-notification
   ```
4. Set environment variable in STAS:
   ```env
   N8N_WHATSAPP_WEBHOOK_URL=https://<your-n8n>/webhook/whatsapp-notification
   ```

**Expected webhook payload:**

```json
{
  "to": "15551234567",
  "text": ":rocket: *PR Created* — Run `run-abc123`\n> Fix: Update login flow",
  "preview_url": true
}
```

**Behavior:**

| Scenario | Response |
|----------|----------|
| Valid payload received | WhatsApp message sent to the specified number |
| Missing to or text | WhatsApp node returns error (logged by n8n) |

### 6. Monitoring Alerts — OS Alerts → #syntaro-alerts (via n8n)

**File:** `workflows/monitoring-alerts.json`

Replaces the in-code alert dispatch (`monitoring/alerting.ts`). OS emits alert events via webhook, n8n formats them as Slack blocks with severity-colored attachments, and posts to `#syntaro-alerts`.

**Severity formatting:**

| Severity | Color | Header |
|----------|-------|--------|
| `critical` | Red (`#E74C3C`) | 🚨 CRITICAL: {rule} |
| `warning` | Yellow (`#F39C12`) | ⚠️ WARNING: {rule} |
| `info` | Blue (`#3498DB`) | ℹ️ INFO: {rule} |
| Unknown | Gray (`#95A5A6`) | ℹ️ Alert: {rule} |

**Setup:**

1. Import `workflows/monitoring-alerts.json` into n8n
2. Configure the **Slack** node with OAuth credentials (chat:write scope)
3. Note the webhook URL (e.g., `https://<your-n8n>/webhook/monitoring-alert`)
4. Set environment variable:

   ```env
   N8N_MONITORING_WEBHOOK_URL=https://<your-n8n>/webhook/monitoring-alert
   ```

**Expected webhook payload:**

```json
{
  "severity": "critical",
  "rule": "queue_depth_critical",
  "message": "Queue depth 250 exceeds critical threshold 200 for 5+ minutes",
  "channel": "#syntaro-alerts",
  "timestamp": "2026-07-21T12:00:00.000Z"
}
```

### 4. Stripe Billing Webhooks (AIM-3340)

**File:** `workflows/stripe-billing.json`

Receives Stripe billing events (invoice paid, payment failed, subscription changes, credit purchases) and processes them entirely in n8n — signature verification, database updates (quota, tier, credits), and Slack notifications to `#billing`.

**Flow:**

```
Stripe webhook → n8n HTTP node (verify signature via Stripe library)
  → Switch (event type):
    → invoice.paid                 → Reset usage quota in DB → Slack alert
    → invoice.payment_failed        → Slack alert with failure details
    → customer.subscription.updated → Sync billing plan + account tier in DB → Slack alert
    → customer.subscription.deleted → Downgrade to free tier in DB → Slack alert
    → checkout.session.completed    → Add credits in DB → Slack alert
    → Unknown event                 → Fallback Slack message
```

**Events handled:**

| Event Type | DB Action | Slack Color | Description |
|------------|-----------|-------------|-------------|
| `invoice.paid` | Reset `usage_count` | Green (`#2ECC71`) | Successful payment — quota reset for new period |
| `invoice.payment_failed` | — | Red (`#E74C3C`) | Payment attempt failed |
| `customer.subscription.updated` | Update `plan` + `tier` | Blue (`#3498DB`) | Plan change or status change |
| `customer.subscription.deleted` | Downgrade to free tier | Red (`#E74C3C`) | Subscription ended — account downgraded |
| `checkout.session.completed` | Add credits to balance | Green (`#2ECC71`) | Credit pack purchased |
| Unknown | — | Gray (`#95A5A6`) | Unhandled event type |

**Setup:**

1. Import `workflows/stripe-billing.json` into n8n
2. Configure the **Slack** node with OAuth credentials (`chat:write` scope) for the `#billing` channel
3. Configure the **Postgres** nodes with your database credentials (shared `postgres` database)
4. Configure the **Stripe** credential in n8n with `STRIPE_SECRET_KEY`
5. Set these environment variables in n8n:

   | Variable | Description |
   |----------|-------------|
   | `STRIPE_SECRET_KEY` | Stripe secret key (for the Verify Signature code node) |
   | `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
   | `N8N_BASE_URL` | (Optional) Base URL for triggering the onboarding email workflow |

6. Configure Stripe to send webhook events to your n8n URL:
   ```
   https://<your-n8n>/webhook/stripe-event
   ```

**Expected webhook payload (raw Stripe event):**

The workflow receives the raw Stripe webhook payload and verifies the signature using the Stripe library. No proxying through the STAS backend is needed.

**Behavior:**

| Scenario | Response |
|----------|----------|
| Invoice paid successfully | Green Slack message to `#billing` + usage quota reset in DB |
| Invoice payment fails | Red Slack message with amount, reason, and attempt count |
| Subscription plan changes | Blue Slack message with new status + DB plan/tier updated |
| Subscription cancelled | Red Slack message + account downgraded to free in DB |
| Credit pack purchased | Green Slack message with amount + credits added in DB |
| Unknown event type | Gray fallback message with raw event type for debugging |

### 5. Weekly Usage Report — DB → #syntaro-metrics (AIM-3337)

**File:** `workflows/weekly-usage-report.json`

Runs every Monday at 9am, queries the database for usage statistics over the past 7 days, and posts a formatted Slack report to `#syntaro-metrics`. Includes week-over-week trend comparisons.

**Flow:**

```
Schedule (every Monday 9am)
  → DB query: current week stats (issues, tokens, tenants, signups, revenue)
  → DB query: previous week stats (for trend comparison)
  → Merge → Format Slack blocks (with trends)
  → Post to #syntaro-metrics
```

**Report sections:**

| Metric | Source | Description |
|--------|--------|-------------|
| Issues Fixed | `run_history` | Completed runs in the last 7 days |
| Fix Rate | `run_history` | Success rate (fixed / total runs) |
| Tokens Consumed | `agent_analytics_runs` | Total LLM tokens used |
| Active Tenants | `usage_records` | Distinct accounts with activity |
| New Signups | `accounts` | Accounts created in the last 7 days |
| Total Accounts | `accounts` | All-time account count |
| Revenue (7d) | `credit_transactions` | Gross revenue from purchases/subscriptions |

Each metric shows the current value plus a week-over-week trend percentage.

**Setup:**

1. Import `workflows/weekly-usage-report.json` into n8n
2. Configure the **Slack** node with OAuth credentials (`chat:write` scope, installed to `#syntaro-metrics`)
3. Configure the **Postgres** nodes with database credentials (shared `postgres` database)
4. No environment variables are needed — the workflow uses static SQL queries

**Behavior:**

| Scenario | Response |
|----------|----------|
| Monday 9am | Formatted report with metrics and trends posted to #syntaro-metrics |
| Database unavailable | Postgres node returns error — n8n retries based on workflow error settings |
| Empty data (new deployment) | Report shows zeros with `-` trends |

## Adding a workflow

1. Design the workflow in the n8n UI
2. Export as JSON: **Workflow** → **Download**
3. Save to `n8n/workflows/<name>.json`
4. Update this README with the workflow name and event types
