---
name: stas
description: STAS — Solving Tickets As A Service. Automatically fix GitHub issues by submitting them to the STAS API.
trigger: stas, fix issue, auto-fix, submit issue, automated PR, STAS
---

# STAS Skill — Automated Issue Fixing

The STAS skill enables any OpenCode or OpenClaw agent to submit GitHub issues to the STAS API for automated fix generation. STAS investigates the codebase, writes a fix, runs regression tests, and opens a PR.

## Prerequisites

1. **STAS API Key** — Subscribe at [RapidAPI Marketplace](https://rapidapi.com/aimino/api/stas-api) or self-host
2. **GitHub Token** — For creating PRs on your behalf (if using the self-hosted instance)

## Configuration

Add these to your environment or `.env`:

```bash
STAS_API_KEY=your-stas-api-key
STAS_API_URL=https://api.syntaro.io
GITHUB_TOKEN=your-github-token  # optional for self-hosted
```

## Tools

### `syntaro_submit_fix`

Submit a GitHub issue for automated fix generation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Full GitHub repo URL (e.g., `https://github.com/owner/repo`) |
| `issueTitle` | string | No | Issue title to fix |
| `issueBody` | string | No | Issue body/description with reproduction steps |
| `issueNumber` | number | No | Existing GitHub issue number (alternative to title+body) |

**Returns:**
```json
{
  "jobId": "stas_job_abc123",
  "status": "pending",
  "estimatedWaitSeconds": 120,
  "pollUrl": "https://api.syntaro.io/api/fix/stas_job_abc123"
}
```

### `syntaro_poll_job`

Poll a running fix job for status updates and final results.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Job ID from `syntaro_submit_fix` |

**Returns:**
```json
{
  "jobId": "stas_job_abc123",
  "status": "completed",
  "prUrl": "https://github.com/owner/repo/pull/42",
  "branch": "stas-fix/login-validation-bug",
  "summary": "Fixed input sanitization in login endpoint",
  "testResults": {
    "passed": 15,
    "failed": 0,
    "newTests": 2
  }
}
```

### `syntaro_list_jobs`

List recent fix jobs with their current statuses.

### `syntaro_get_eval_results`

Get public STAS benchmark evaluation results showing pass rates across different benchmarks.

## Workflows

### Quick Fix: Submit an Issue URL

```
User: "Fix the login bug in https://github.com/owner/repo issue #42"
Agent: [calls syntaro_submit_fix with repoUrl and issueNumber]
       [polls syntaro_poll_job until complete]
       "Created PR #42 with the fix. Test results: 15 passed, 0 failed."
```

### Full Fix: Describe a Bug

```
User: "The /api/users endpoint in my repo returns 500 when email has a '+' sign"
Agent: [calls syntaro_submit_fix with repoUrl, issueTitle, issueBody]
       [polls syntaro_poll_job until complete]
       "Fix submitted. PR #43 opened with the fix and 2 new regression tests."
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| `invalid_api_key` | Missing or invalid STAS API key | Check `STAS_API_KEY` env var |
| `repo_not_found` | Repository not found or inaccessible | Verify repo URL and permissions |
| `job_not_found` | Invalid job ID | Verify the job ID from `syntaro_submit_fix` |
| `rate_limited` | API rate limit exceeded | Wait for the next window or upgrade plan |

## Links

- **RapidAPI Marketplace**: https://rapidapi.com/aimino/api/stas-api
- **GitHub Repository**: https://github.com/tamnguyen08/solving_tickets_as_a_service
- **Documentation**: https://github.com/tamnguyen08/solving_tickets_as_a_service/blob/main/README.md
- **Smithery Registry**: https://smithery.ai/server/@aimino/syntaro-mcp
