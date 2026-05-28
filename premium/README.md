# STAS Premium

> **This directory is NOT part of the MIT open-source license.**
> It describes the proprietary hosted service and contains placeholder/private code.

The OSS repo (`src/`, `plugin/`) is the self-hostable GitHub bot. This directory documents everything that makes the paid version worth paying for.

## What Premium Adds

| Feature | OSS (MIT) | Premium ($49/mo) |
|---|---|---|
| **Agent model** | Your API key, any model | Our AGI (50% better than GPT-5.5) |
| **Hosting** | You run it | We run it |
| **Install** | Manual setup | One-click GitHub App |
| **Dashboard** | — | Run history, analytics, audit log |
| **Repos** | Single repo | Unlimited repos |
| **Concurrent fixes** | 1-3 (configurable) | 10+ |
| **Sandbox** | Local Docker | Cloud E2B, auto-scaling |
| **Billing** | — | Stripe $49/mo |
| **SSO/SAML** | — | Team/Enterprise |
| **Support** | GitHub issues | Slack, email, SLA |

## Premium Architecture

The OSS codebase is built on a KintsugiBot-inspired stack: **Express** webhooks → **BullMQ/Redis** queue → **E2B** sandbox → **@octokit** GitHub API → **pino** logging. The premium hosted service runs the same core stack but replaces the user's model with our AGI and adds a dashboard, multi-tenant database, and billing.

```
┌─────────────────────────────────────────────┐
│          STAS Premium Hosted                │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────┐   ┌─────────────────────┐  │
│  │ Dashboard   │   │  Express Webhook    │  │
│  │ (Vite/React)│   │  Server + API       │  │
│  │             │   │  (pino logging)     │  │
│  └─────────────┘   └──────────┬──────────┘  │
│                               │             │
│  ┌────────────────────────────▼────────────┐ │
│  │       BullMQ + Redis Job Queue         │ │
│  │  (rate limiting, concurrency mgmt,     │ │
│  │   retry with backoff, dead-letter)     │ │
│  └────────────────────────────┬────────────┘ │
│                               │             │
│  ┌────────────────────────────▼────────────┐ │
│  │         Our AGI Router                 │ │
│  │  (proprietary model, 50% better than   │ │
│  │   GPT-5.5 on DeepSWE, OpenAI-compat)   │ │
│  └────────────────────────────┬────────────┘ │
│                               │             │
│  ┌────────────────────────────▼────────────┐ │
│  │         E2B Sandbox Pool               │ │
│  │  (auto-scaling ephemeral microVMs,     │ │
│  │   isolated per-job execution)          │ │
│  └────────────────────────────┬────────────┘ │
│                               │             │
│  ┌────────────────────────────▼────────────┐ │
│  │   @octokit / GitHub API Client         │ │
│  │   (PR creation, issue comments,        │ │
│  │   repo clone, status updates)          │ │
│  └─────────────────────────────────────────┘ │
│                                             │
│  ┌─────────────────────┐ ┌────────────────┐ │
│  │  Postgres           │ │  Stripe        │ │
│  │  (teams, runs,      │ │  (billing,     │ │
│  │  audit log, usage)  │ │  subscriptions)│ │
│  └─────────────────────┘ └────────────────┘ │
└─────────────────────────────────────────────┘
```

## Premium Code

The premium code lives in a **private repository**. This directory contains:

| File | Purpose |
|---|---|
| `src/` | Premium-only code (placeholder) |
| `docs/` | Premium architecture docs |
| `deploy/` | Cloud deployment manifests |
| `README.md` | This file |

The OSS repo communicates with premium services via:
- **Environment variables** — swap `OPENCODE_URL` for our AGI endpoint
- **Feature flags** — `STAS_PREMIUM=true` enables premium features
- **API contract** — premium services implement the same OpenCode-compatible API

## Switching from OSS to Premium

```bash
# In your .env, change:
OPENCODE_URL=https://api.stas.dev/agi  # Our AGI endpoint
STAS_PREMIUM=true                       # Enable premium features
```

No code changes needed. The bot works the same way — just with a better model behind it.
