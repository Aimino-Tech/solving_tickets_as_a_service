---
name: stas
description: STAS — Solving Tickets As A Service. Submit fix requests, check status, view run history, and list repositories through the MCP API.
routes:
  - mcp
---

# STAS Skill

STAS (Solving Tickets As A Service) is a GitHub bot that takes issue descriptions, investigates your codebase, writes a fix, runs tests, and opens a PR. Agents access STAS through its MCP API.

## Tools

### submit_issue

**POST** `/mcp/submit_issue`

Submit a new issue fix request.

```json
{
  "repoOwner": "string (required)",
  "repoName": "string (required)",
  "issueTitle": "string (required, max 500)",
  "issueBody": "string (required, max 50000)",
  "labels": ["optional string array"],
  "channel": "optional — slack, telegram, whatsapp",
  "channelTarget": "optional — channel-specific target"
}
```

Response: `{ "runId": "uuid", "status": "accepted", "pollUrl": "...", "createdAt": "..." }`

### check_status

**GET** `/mcp/status/:runId`

Response: `{ "runId": "...", "status": "queued|investigating|fixing|testing|verifying|committing|completed|failed|error", "prUrl": "...", ... }`

### get_run_history

**GET** `/mcp/history?limit=50`

Response: `{ "runs": [...], "total": number }`

### list_repos

**GET** `/mcp/repos`

Response: `{ "repos": [{ "owner": "...", "name": "...", "private": boolean }] }`

## Channel Integration

| Channel | Command | Config Required |
|---------|---------|-----------------|
| Slack | `/stas fix <description>` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` |
| Telegram | `/fix <description>` | `TELEGRAM_BOT_TOKEN` |
| WhatsApp | `fix <description>` | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` |

## Auth

Include `Authorization: Bearer <MCP_API_KEY>` header for MCP endpoints. Set `MCP_AUTH_ENABLED=false` to disable.
