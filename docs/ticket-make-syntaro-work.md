# [SYNTARO-1] Make SYNTARO Work End-to-End — Compilation & Runtime Fixes

## Context

SYNTARO is an open-source GitHub bot that turns labeled issues into pull requests. The codebase has been architecturally designed with all 8 phases of the agent pipeline (triage → OpenCode dispatch → E2B sandbox → verification → PR creation), webhook receivers for 5 platforms, Stripe billing, Slack notifications, and admin API. However, the code has **never been compiled or run** — there are 33 TypeScript compilation errors and missing runtime configuration.

## Input

Source code at `src/`:

- `src/server.ts` — Express webhook server
- `src/agent/issueAgent.ts` — 8-phase agent pipeline
- `src/queue/` — BullMQ/Redis + RabbitMQ dual-write
- `src/bridge/` — CrossServiceBridge (Python/RabbitMQ)
- `src/stripe/` — Stripe billing integration
- `src/config.ts` — Zod-validated environment config
- `src/db/` — Database layer (Drizzle/Kysely)
- `src/security/` — Audit logging

## Output

A working SYNTARO server that:

1. Compiles with **zero TypeScript errors** (`npx tsc --noEmit`)
2. Loads environment from `.env` without zod validation failures
3. Starts the Express server on port 3000 and responds to `GET /health`
4. Connects to Redis and creates the BullMQ queue
5. Handles GitHub webhooks through the full pipeline

## Suggested Implementation

### Phase 1: Fix TypeScript Compilation Errors

**8 categories of errors to fix:**

| # | File | Error | Fix |
|---|------|-------|-----|
| 1 | `src/config.ts:158,179,180` | Duplicate properties (`ADMIN_API_KEY`, `FEATURE_FLAGS_DEFAULT_TTL_SECONDS`, `FEATURE_FLAGS_AUTO_DISABLE_THRESHOLD`) | Remove the duplicate property declarations at lines 157-180 (the security and feature flags section duplicates earlier entries) |
| 2 | `src/queue/rabbitmq.ts:75,78,83,93,97` | Local `connect()` function shadows `amqplib` import — `connect(url)` at line 75 calls itself recursively | Rename amqplib import: `import { connect as amqpConnect, ... }` and use `amqpConnect(url)` |
| 3 | `src/security/audit.ts:52` | `{ db }` not exported from `../db/index.js` — only `pool`, `queryWithRetry`, migration/schema helpers exist | Replace `db.insertInto('audit_logs')` with raw SQL via `queryWithRetry` using pool |
| 4 | `src/agent/issueAgent.ts` | 8 errors: missing `getTracker` import (×2), missing `installationId` (×3), `repoUrl` not in param type (×2), `verificationFailed`→`verification` | Add import, add `installationId` to `OpenCodeDispatchParams`, remove `repoUrl` from call/context, fix property name |
| 5 | `src/stripe/webhook.ts` | API version mismatch, `invoice.subscription` removed, `subscription.current_period_*` changed | Bump API version, cast `invoice` to access subscription, use new Subscription fields |
| 6 | `src/server.ts:597` | Handler called with 3 args expects 2 | Remove `next` from call or update Express error handler signature |
| 7 | `src/__tests__/*` | Duplicate identifiers, ConcurrencyManager type | Fix test imports and add `typeof` or explicit type annotation |
| 8 | `src/bridge/bridge.ts` | 3 implicit `any` params | Add `: any` type annotations |

### Phase 2: Verify Compilation

```bash
npx tsc --noEmit
# Expected: zero errors
```

### Phase 3: Runtime Setup & Verification

```bash
cp .env.example .env
# Configure basic env vars (at minimum: PORT, LOG_LEVEL, NODE_ENV)
pnpm dev
# Verify GET /health returns 200
```

## Fast E2E Test

```typescript
// After PR start the server and verify health endpoint
import { describe, it, expect } from 'vitest';
import http from 'http';

describe('SYNTARO Server', () => {
  it('responds to health check', async () => {
    const res = await fetch('http://localhost:3000/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

## Dependencies

- pnpm workspace with TypeScript 5.x
- Deps already installed: Express, BullMQ, Redis, OpenAI, Stripe 22.x, Slack Bolt, E2B, Zod
- Missing `@types/amqplib` — added as devDependency
