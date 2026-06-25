# STAS MCP Server — Auto-Fix GitHub Issues

Connect your MCP-compatible IDE (Claude, Cursor, Windsurf, etc.) to STAS and automatically fix GitHub issues with AI-generated pull requests.

## What is STAS?

STAS (Solving Tickets As A Service) is an open-source GitHub bot that investigates your codebase, writes fixes, runs tests, and opens PRs — all triggered by a labeled issue.

## MCP Tools

This server exposes four tools through the Model Context Protocol:

### `stas_submit_fix`
Submit a GitHub issue URL for automated fix generation. STAS will:
1. Clone the repository
2. Investigate the root cause
3. Write a fix
4. Add regression tests
5. Run the existing test suite
6. Commit and push to a new branch
7. Open a draft PR

### `stas_poll_job`
Poll a running fix job for status updates and final results including the PR URL and test results.

### `stas_list_jobs`
List recent fix jobs and their statuses across your account.

### `stas_get_eval_results`
Get public STAS benchmark evaluation results showing pass rates.

## Getting Started

1. Install the MCP server
2. Subscribe to a RapidAPI plan
3. Set `STAS_API_KEY` environment variable
4. Use any MCP-compatible client to start fixing issues

## Example

```json
{
  "repoUrl": "https://github.com/owner/repo",
  "issueNumber": 42
}
```

Output: `"Created PR #43 — Fixed input sanitization. Tests: 15 passed, 0 failed."`
