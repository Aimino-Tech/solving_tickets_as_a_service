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

### 3. Monitoring Alerts — OS Alerts → #syntaro-alerts (via n8n)

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

### 5. Stripe Billing Webhooks (AIM-3340)

**File:** `workflows/stripe-billing.json`

Receives Stripe billing events forwarded from the STAS backend (which verifies the Stripe webhook signature) and routes them to the appropriate internal APIs for processing.

**Events handled:**

| Event Type | Action | Description |
|------------|--------|-------------|
| `checkout.session.completed` | Credit account via API | One-time credit purchase |
| `invoice.paid` | Subscription credit top-up | Monthly subscription credit grant |
| `invoice.payment_failed` | Notify account holder | Failed payment notification |
| `customer.subscription.updated` | Sync billing plan | Update plan in database |
| `customer.subscription.deleted` | Downgrade to free | Revert account to free tier |
| Unknown | Logged | Fallback for unhandled event types |

**Flow:**

```
STAS Stripe webhook handler (signature verification)
  → POST /webhook/stripe-billing-event → n8n
  → Switch by event type
    → checkout.session.completed → HTTP POST → /api/v1/credits/credit
    → invoice.paid              → HTTP POST → /api/v1/credits/subscription-topup
    → invoice.payment_failed    → HTTP POST → /api/v1/notifications/payment-failed
    → customer.subscription.updated → HTTP POST → /api/v1/billing/sync-subscription
    → customer.subscription.deleted → HTTP POST → /api/v1/billing/downgrade-account
    → Unknown → Logged
```

**Setup:**

1. Import `workflows/stripe-billing.json` into n8n
2. Configure **STAS API** credentials:
   - Create a credential of type "Header Auth" named `stasApiKey`
   - Set the header with `x-admin-key` and the admin API key value
3. Set environment variable:

   ```env
   N8N_STRIPE_WEBHOOK_URL=https://<your-n8n>/webhook/stripe-billing-event
   ```

**Expected webhook payload (from STAS backend):**

```json
{
  "event": "stripe",
  "type": "checkout.session.completed",
  "data": {
    "customer_id": "cus_abc123",
    "customer_email": "user@example.com",
    "subscription_id": "sub_123456",
    "amount": 29.99,
    "amount_cents": 2999,
    "currency": "usd",
    "failure_reason": null,
    "metadata": {}
  }
}
```

**Behavior:**

| Scenario | Response |
|----------|----------|
| Credit pack purchased | Account credited via internal API |
| Subscription invoice paid | Monthly credits added to account |
| Payment fails | Notification sent to account holder |
| Subscription updated | Billing plan synced in database |
| Subscription cancelled | Account downgraded to free tier |
| Unknown event type | Logged for debugging |

## Adding a workflow

1. Design the workflow in the n8n UI
2. Export as JSON: **Workflow** → **Download**
3. Save to `n8n/workflows/<name>.json`
4. Update this README with the workflow name and event types
