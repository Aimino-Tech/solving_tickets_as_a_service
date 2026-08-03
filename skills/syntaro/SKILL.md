---
name: stas
description: STAS — Solving Tickets As A Service. Submit fix requests to a GitHub bot that investigates, fixes, tests, and opens PRs.
version: 0.2.0
author: Aimino Tech
license: MIT
homepage: https://github.com/Aimino-Tech/solving_tickets_as_a_service
installUrl: https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/skills/stas/SKILL.md
tags:
  - github
  - automation
  - code-review
  - pr-creation
  - bug-fixing
  - mcp
  - api
  - developer-tools
routes:
  - mcp
  - api
categories:
  - productivity
  - developer-tools
  - ci-cd
platforms:
  - opencode
  - openclaw
  - claude-code
capabilities:
  tools:
    - submit_issue
    - check_status
    - get_run_history
    - list_repos
    - poll_job
  resources:
    - syntaro://runs/{run_id}
    - syntaro://issues/{issue_id}
    - syntaro://jobs/{job_id}
  mcp:
    transport: stdio
    command: python3
    args:
      - -m
      - syntaro_mcp.server
      - stdio
---

# STAS Skill — Solving Tickets As A Service

STAS is a GitHub bot that takes issue descriptions, investigates your codebase, writes a fix, runs tests, and opens a PR. Agents access STAS through its MCP (Model Context Protocol) API.

## Quick Install

### OpenCode
Add to `opencode.json`:
```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "syntaro_mcp.server", "stdio"]
    }
  }
}
```

Or run:
```bash
bash syntaro_mcp/install.sh --opencode
```

### Claude Code
```bash
npx stas install-mcp --claude
```

### Cursor
1. Open Cursor Settings → Features → MCP Servers
2. Click **+ Add New MCP Server**
3. Name: `stas`, Type: `command`, Command: `python3 -m syntaro_mcp.server stdio`

### Codex CLI
Add to `.codex/config.json`:
```json
{
  "mcpServers": {
    "stas": {
      "command": "python3",
      "args": ["-m", "syntaro_mcp.server", "stdio"]
    }
  }
}
```

## Tools

### submit_issue

Submit a new issue fix request to STAS. This triggers the full pipeline: investigation → fix → test → PR.

**HTTP:** `POST /mcp/submit_issue`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoOwner` | string | ✅ | GitHub repository owner (user or org) |
| `repoName` | string | ✅ | GitHub repository name |
| `issueTitle` | string | ✅ | Issue title (max 500 chars) |
| `issueBody` | string | ✅ | Issue description (max 50,000 chars) |
| `labels` | string[] | ❌ | Labels to apply to the issue |
| `channel` | enum | ❌ | Notification channel: `slack`, `telegram`, `whatsapp` |
| `channelTarget` | string | ❌ | Channel-specific target ID |

**Example:**

```json
{
  "repoOwner": "my-org",
  "repoName": "my-repo",
  "issueTitle": "Login form returns 500 on special chars",
  "issueBody": "When email contains '+' or '&', the login endpoint crashes with a 500 error.",
  "labels": ["bug", "high-priority"]
}
```

**Response:**

```json
{
  "runId": "stas-a1b2c3d4e5f6",
  "status": "accepted",
  "pollUrl": "https://api.stas.ai/mcp/status/stas-a1b2c3d4e5f6",
  "createdAt": "2026-07-17T10:30:00Z"
}
```

**Error Responses:**

| Code | Meaning |
|------|---------|
| 400 | Missing required fields or field length exceeded |
| 401 | Missing or invalid `Authorization` header |
| 429 | Rate limit exceeded — retry after `Retry-After` header |
| 500 | Internal pipeline error |

---

### check_status

Poll the current status of a fix run.

**HTTP:** `GET /mcp/status/:runId`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runId` | string | ✅ | Run ID returned by `submit_issue` |

**Response:**

```json
{
  "runId": "stas-a1b2c3d4e5f6",
  "status": "investigating",
  "prUrl": null,
  "createdAt": "2026-07-17T10:30:00Z",
  "updatedAt": "2026-07-17T10:31:15Z"
}
```

**Status Lifecycle:**

```
queued → investigating → fixing → testing → verifying → committing → completed
                                                                  └→ failed
                                                                  └→ error
```

| Status | Description |
|--------|-------------|
| `queued` | Run is waiting for a worker |
| `investigating` | Agent is analyzing the issue and codebase |
| `fixing` | Agent is implementing the fix |
| `testing` | Agent is running the test suite |
| `verifying` | Regression tests are passing validation |
| `committing` | Changes are being committed and pushed |
| `completed` | PR has been created successfully |
| `failed` | Fix could not be completed |
| `error` | Internal system error occurred |

**Error Responses:**

| Code | Meaning |
|------|---------|
| 404 | Run ID not found |
| 401 | Missing or invalid `Authorization` header |

---

### get_run_history

Retrieve the history of all fix runs.

**HTTP:** `GET /mcp/history?limit=50`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | ❌ | Max results (default: 50, max: 200) |

**Response:**

```json
{
  "runs": [
    {
      "runId": "stas-a1b2c3d4e5f6",
      "status": "completed",
      "repoOwner": "my-org",
      "repoName": "my-repo",
      "issueNumber": 42,
      "prUrl": "https://github.com/my-org/my-repo/pull/123",
      "createdAt": "2026-07-17T10:30:00Z"
    }
  ],
  "total": 1
}
```

---

### list_repos

List GitHub repositories configured for STAS access.

**HTTP:** `GET /mcp/repos`

**Response:**

```json
{
  "repos": [
    {
      "owner": "my-org",
      "name": "my-repo",
      "private": false
    }
  ]
}
```

## Resources (MCP)

STAS exposes MCP resources for agent consumption:

| Resource URI | Description |
|---|---|
| `syntaro://runs/{run_id}` | Full run details: status, timestamps, issue info, PR link |
| `syntaro://issues/{issue_id}` | Issue details with current fix status and run history |

## Authentication

Include the `Authorization` header on all MCP API requests:

```
Authorization: Bearer <MCP_API_KEY>
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_API_KEY` | — | API key for MCP authentication |
| `MCP_AUTH_ENABLED` | `true` | Enable/disable auth |
| `STAS_MCP_PORT` | `4095` | MCP server port (SSE mode) |
| `STAS_MCP_HOST` | `0.0.0.0` | MCP server bind address |
| `STAS_MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `sse` |

## Error Handling

All tools return errors in a consistent format:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

**Common Error Codes:**

| Code | Meaning |
|------|---------|
| `VALIDATION_ERROR` | Missing or invalid parameters |
| `AUTH_ERROR` | Missing or invalid API key |
| `NOT_FOUND` | Resource (run, issue) not found |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected system error |
| `GITHUB_API_ERROR` | Upstream GitHub API failure |

## Channel Integrations

STAS sends notifications to external channels:

| Channel | Command | Required Config |
|---------|---------|-----------------|
| Slack | `/stas fix <description>` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |
| Telegram | `/fix <description>` | `TELEGRAM_BOT_TOKEN` |
| WhatsApp | `fix <description>` | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` |

## Run Modes

The STAS MCP server supports two transport modes:

### stdio (default, for local agents)

```bash
python -m syntaro_mcp.server stdio
```

### SSE (for remote/network agents)

```bash
python -m syntaro_mcp.server sse --port 4095 --host 0.0.0.0
```

## Verify Installation

```bash
# List available MCP tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m syntaro_mcp.server stdio

# Or via HTTP (SSE mode)
python -m syntaro_mcp.server sse &
curl http://localhost:4095/health
```
