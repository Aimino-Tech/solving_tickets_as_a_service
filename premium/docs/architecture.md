# Premium Architecture

## Overview

The premium hosted service is a separate deployment that shares the same OSS bot stack but adds:
1. Our AGI model as the backing agent (replaces user's OpenCode server)
2. A web dashboard for monitoring and analytics
3. Multi-tenant database for teams and audit
4. Stripe billing integration

The underlying OSS stack follows the KintsugiBot-inspired architecture: **Express** webhooks → **BullMQ/Redis** queue → **E2B** sandbox → **@octokit** GitHub API → **pino** logging. Premium wraps this with our AGI, dashboard, and enterprise features.

## Deployment

```
┌──────────────────────┐
│   GitHub / Cloudflare│  Webhooks + CDN
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   Dashboard          │  Vite/React app
│   (dashboard.stas.)  │  (pino logging)
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   Express Webhook    │  Same core stack as OSS,
│   Server + API       │  with premium middleware
│   (api.stas.dev)     │  (pino logging)
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   BullMQ + Redis     │  Job queue with rate limiting,
│                      │  concurrency mgmt, retry/backoff
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   Our AGI            │  Proprietary model, OpenAI-compatible API
│   (agi.stas.dev)     │  50% better than GPT-5.5 on DeepSWE
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   E2B Sandbox Pool   │  Auto-scaling ephemeral microVMs,
│                      │  isolated per-job execution
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   @octokit / GitHub  │  PR creation, issue comments,
│   API Client         │  repo clone, status updates
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   Postgres           │  Teams, runs, audit logs, usage
└─────────┬────────────┘
          │
┌─────────▼────────────┐
│   Stripe             │  Billing, subscriptions, tiers
└──────────────────────┘
```

## Premium Middleware (added to OSS Express + BullMQ)

```
GitHub webhook → Express server → BullMQ job → premium middleware stack:
  1. Auth check (is this a premium account?)
  2. Rate limit (check plan limits via Redis)
  3. Log to audit (record all actions in Postgres)
  4. Route to AGI (instead of user's OpenCode serve)
  5. Run fix in E2B sandbox (isolated ephemeral microVM)
  6. Post result via @octokit (PR, comment, status)
  7. Record outcome (success/fail, cost, duration, logs)
```

## Database Schema (premium additions)

```sql
-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name TEXT,
  stripe_customer_id TEXT,
  plan TEXT CHECK (plan IN ('solo', 'team', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Team members
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id),
  github_user_id BIGINT,
  role TEXT CHECK (role IN ('admin', 'member')),
  PRIMARY KEY (team_id, github_user_id)
);

-- Repo installations
CREATE TABLE repo_installations (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  owner TEXT,
  repo TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fix runs (audit log)
CREATE TABLE fix_runs (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  repo TEXT,
  issue_number INTEGER,
  status TEXT CHECK (status IN ('queued', 'running', 'success', 'failed')),
  model_used TEXT,
  cost_cents INTEGER,
  duration_seconds INTEGER,
  pr_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
