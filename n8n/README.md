# n8n Workflows for STAS / OpenSymphony

This directory contains n8n workflow JSON exports for integrating external services.

## Workflows

### 1. Slack Alerts — OS Events → #syntaro-alerts

**File:** `workflows/slack-alerts.json`

Receives webhook events from OpenSymphony and posts formatted alerts to `#syntaro-alerts`.

**See also:** `workflows/slack-alerts.json`

### 2. Crisp AI Support Bot

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

## Adding a workflow

1. Design the workflow in the n8n UI
2. Export as JSON: **Workflow** → **Download**
3. Save to `n8n/workflows/<name>.json`
4. Update this README with the workflow name and event types
