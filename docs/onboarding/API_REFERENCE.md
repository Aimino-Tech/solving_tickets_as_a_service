# API Reference

> **Complete reference for STAS's REST API endpoints.**

Base URL: `http://localhost:3000` (self-hosted) or `https://stas-api.aimino.com` (cloud)

---

## Table of Contents

- [Authentication](#authentication)
- [Health](#health)
- [Webhooks](#webhooks)
- [Fixes](#fixes)
- [Runs](#runs)
- [Onboarding](#onboarding)
- [Billing](#billing)
- [Admin](#admin)
- [RapidAPI](#rapidapi)

---

## Authentication

Most endpoints require a GitHub App installation token or a user JWT.

### Getting a Token

```bash
# GitHub App installation token (for webhook-triggered operations)
# Automatically managed by the app — no manual step needed.

# User JWT (for dashboard/API access)
POST /api/auth/login
```

### Using a Token

Include the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/runs
```

---

## Health

### `GET /health`

Basic health check. Returns service status.

**Response `200`:**

```json
{
  "status": "ok",
  "service": "stas-bot",
  "version": "0.1.0",
  "uptime": 42
}
```

### `GET /api/health`

Detailed health status including dependencies.

**Response `200`:**

```json
{
  "status": "ok",
  "redis": "connected",
  "opencode": "connected",
  "queue": {
    "pending": 3,
    "in_progress": 1,
    "failed": 0
  },
  "version": "0.1.0"
}
```

### `GET /api/health/workers`

Celery worker health check.

**Response `200`:**

```json
{
  "status": "ok",
  "workers": [
    {
      "name": "celery@host1",
      "queues": [
        "stas.agents.dispatch",
        "stas.agents.sandbox"
      ],
      "concurrency": 4,
      "active_tasks": 2
    }
  ]
}
```

---

## Webhooks

### `POST /webhook/github`

Receive GitHub webhook events. STAS processes `labeled` events matching `stas:fix` to trigger fix runs.

**Headers:**

| Header | Required | Description |
|---|---|---|
| `X-GitHub-Event` | ✅ | GitHub event type (e.g., `issues`) |
| `X-GitHub-Delivery` | ✅ | Unique delivery ID |
| `X-Hub-Signature-256` | ✅ | HMAC-SHA256 signature for verification |

**Request Body:** Standard GitHub webhook payload (see [GitHub docs](https://docs.github.com/en/webhooks/webhook-events-and-payloads)).

**Response `200`:** `OK`

**Response `400`:** `Invalid signature` (if HMAC verification fails)

### `POST /webhook/gitlab`

Receive GitLab webhook events.

**Headers:**

| Header | Required | Description |
|---|---|---|
| `X-Gitlab-Event` | ✅ | GitLab event type |
| `X-Gitlab-Token` | ✅ | Shared secret token |

**Response `200`:** `OK`

### `POST /webhook/bitbucket`

Receive Bitbucket webhook events.

**Response `200`:** `OK`

---

## Fixes

### `POST /api/fix`

Submit a fix job programmatically (not via webhook).

**Request:**

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "issueTitle": "Fix login validation bug",
  "issueBody": "The login endpoint returns 500 when the email contains special characters."
}
```

**Response `201`:**

```json
{
  "jobId": "fix_abc123",
  "status": "queued",
  "estimatedWait": 30
}
```

### `GET /api/fix/:jobId`

Poll the status of a fix job.

**Response `200`:**

```json
{
  "jobId": "fix_abc123",
  "status": "in_progress",
  "step": "investigating",
  "prUrl": null
}
```

**Response `200` (completed):**

```json
{
  "jobId": "fix_abc123",
  "status": "completed",
  "prUrl": "https://github.com/owner/repo/pull/42",
  "prNumber": 42,
  "evidenceReport": "https://github.com/owner/repo/pull/42#issuecomment-..."
}
```

**Response `200` (failed):**

```json
{
  "jobId": "fix_abc123",
  "status": "failed",
  "error": "Investigation timed out after 180s",
  "attempts": 3
}
```

---

## Runs

### `GET /api/runs`

List agent runs. Supports pagination.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max results (max 100) |
| `offset` | integer | 0 | Pagination offset |
| `status` | string | — | Filter by status |
| `repo` | string | — | Filter by repository full name |

**Response `200`:**

```json
{
  "runs": [
    {
      "id": 1,
      "issue": "owner/repo#42",
      "status": "completed",
      "prUrl": "https://github.com/owner/repo/pull/42",
      "createdAt": "2026-06-25T10:00:00Z",
      "updatedAt": "2026-06-25T10:05:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### `GET /api/runs/:id`

Get details of a specific agent run.

**Response `200`:**

```json
{
  "id": 1,
  "issue_url": "https://github.com/owner/repo/issues/42",
  "issue_number": 42,
  "repo_full_name": "owner/repo",
  "installation_id": "inst_123",
  "status": "completed",
  "pr_url": "https://github.com/owner/repo/pull/42",
  "pr_number": 42,
  "log": "...",
  "created_at": "2026-06-25T10:00:00Z",
  "updated_at": "2026-06-25T10:05:00Z"
}
```

---

## Onboarding

### `GET /api/onboarding/status`

Get the onboarding status for the current tenant.

**Response `200`:**

```json
{
  "tenant_id": "t-1",
  "state": "github_installed",
  "github_installed": true,
  "linear_authed": false,
  "repo_selected": false,
  "completed": false,
  "installed_repos": 5,
  "created_at": "2026-06-25T10:00:00Z",
  "updated_at": "2026-06-25T10:02:00Z"
}
```

**States:**

| State | Description |
|---|---|
| `not_started` | Tenant has not started onboarding |
| `github_installed` | GitHub App installed on at least one repo |
| `linear_authed` | Linear OAuth completed |
| `repo_selected` | Repository selected for fixes |
| `completed` | Onboarding wizard complete |

### `POST /api/onboarding/transition`

Advance onboarding to the next step.

**Request:**

```json
{
  "event": "install_github",
  "installation_id": "inst_456"
}
```

**Valid events:**

| Event | Target State | Payload |
|---|---|---|
| `install_github` | `github_installed` | `installation_id` |
| `auth_linear` | `linear_authed` | `linear_org_id` |
| `select_repo` | `repo_selected` | `installed_repos` |
| `complete` | `completed` | — |

**Response `200`:**

```json
{
  "tenant_id": "t-1",
  "state": "github_installed",
  "github_installed": true,
  "linear_authed": false,
  "repo_selected": false,
  "completed": false
}
```

**Response `400` (invalid transition):**

```json
{
  "error": "Invalid transition: 'not_started' --[complete]--> 'completed'. Allowed transitions: ['github_installed']"
}
```

### `DELETE /api/onboarding/reset`

Reset onboarding state for the current tenant.

**Response `200`:**

```json
{
  "status": "reset",
  "tenant_id": "t-1"
}
```

---

## Billing

### `GET /api/billing/subscription`

Get the current subscription details.

**Response `200`:**

```json
{
  "plan": "free",
  "active": true,
  "fixesUsed": 3,
  "fixesLimit": 10,
  "periodEnd": "2026-07-25T00:00:00Z"
}
```

### `POST /api/billing/upgrade`

Initiate a subscription upgrade.

**Request:**

```json
{
  "plan": "pro"
}
```

**Response `200`:**

```json
{
  "status": "upgrade_initiated",
  "redirectUrl": "https://checkout.stripe.com/..."
}
```

### `GET /api/billing/usage`

Get usage records.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max results |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "usage": [
    {
      "date": "2026-06-25",
      "fixesUsed": 2,
      "creditsConsumed": 10
    }
  ],
  "total": 1
}
```

---

## Admin

### `POST /api/admin/trigger`

Manually trigger a fix for testing purposes.

**Request:**

```json
{
  "issueUrl": "https://github.com/owner/repo/issues/42"
}
```

**Response `201`:**

```json
{
  "jobId": "fix_admin_001",
  "status": "queued"
}
```

### `GET /api/admin/queue`

Inspect the task queue depth.

**Response `200`:**

```json
{
  "queues": {
    "stas.agents.triage": 2,
    "stas.agents.dispatch": 5,
    "stas.agents.sandbox": 1,
    "stas.agents.verification": 0,
    "stas.agents.pr_creation": 0
  }
}
```

---

## RapidAPI

Public endpoints available via the [RapidAPI Marketplace](https://rapidapi.com/aimino/api/stas-api).

### `GET /api/eval/results`

Aggregate evaluation results (no auth required).

**Response `200`:**

```json
{
  "swe_bench_lite": {
    "pass_rate": 0.70,
    "timestamp": "2026-06-25T00:00:00Z"
  },
  "totalFixes": 1250
}
```

### `GET /api/eval/latest`

Latest full evaluation run.

**Response `200`:**

```json
{
  "benchmark": "SWE-bench Lite",
  "date": "2026-06-25",
  "passRate": 0.70,
  "avgCostPerFix": 5.80,
  "model": "Our AGI"
}
```

---

## Error Codes

| Code | Meaning |
|---|---|
| `invalid_signature` | Webhook HMAC verification failed |
| `invalid_transition` | Onboarding state transition not allowed |
| `not_found` | Requested resource does not exist |
| `rate_limited` | Too many requests |
| `sandbox_error` | Sandbox environment failed to start |
| `model_error` | AI model returned an error or timed out |
| `quota_exceeded` | Fix quota exceeded for the billing plan |

**Error Response Format:**

```json
{
  "error": "not_found",
  "message": "Run with ID 999 not found",
  "requestId": "req_abc123"
}
```

---

## Rate Limiting

| Endpoint Group | Limit | Window |
|---|---|---|
| `/health`, `/api/health` | 60 requests | 1 minute |
| `/api/runs` | 30 requests | 1 minute |
| `/api/fix` | 10 requests | 1 minute |
| `/api/admin/*` | 5 requests | 1 minute |
| `/webhook/*` | No limit (GitHub-managed) | — |

Rate-limited responses include headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After`

---

## Pagination

Endpoints that return lists support cursor-based pagination:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer | Results per page (default: 50, max: 100) |
| `cursor` | string | Pagination cursor from previous response |

**Paginated response shape:**

```json
{
  "data": [...],
  "nextCursor": "abc123",
  "hasMore": true
}
```
