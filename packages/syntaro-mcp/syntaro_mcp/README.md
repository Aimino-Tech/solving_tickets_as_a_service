# SYNTARO MCP Server

Expose SYNTARO / OpenSymphony as agent infrastructure — so external agents (OpenCode, Claude, Cursor, etc.) can drive our software through the [Model Context Protocol](https://modelcontextprotocol.io).

## What an agent can do

| Tool | Description |
|------|-------------|
| `syntaro_label_issue` | Label a GitHub issue (`syntaro:fix` or custom) |
| `syntaro_run_fix` | Trigger the SYNTARO fix pipeline for a GitHub issue URL |
| `syntaro_check_status` | Poll the status of a fix run by `run_id` |
| `syntaro_get_pr` | Get the PR URL/details for a completed run |
| `list_issues` | List tracked issues with fix status |
| `search_codebase` | Search the SYNTARO codebase for symbols/patterns |
| `linear_ticket` | Check whether a Linear ticket exists (e.g. `AIM-4477`) |
| `linear_create_ticket` | Create a Linear ticket (title, description, priority, team key) |
| `memory_read` | Read a Hermes-style agent memory file by name |
| `memory_write` | Write a Hermes-style agent memory file by name |
| `slack_send` | Post a message to a Slack channel/thread (SYNTARO bot token) |
| `session_resume` | Return a conversation workspace's maintained `MEMORY.md` |

Resources: `syntaro://runs/{run_id}` (run details) and `syntaro://issues/{issue_id}` (issue + fix status).

## Install

```bash
pip install mcp  # FastMCP runtime
# or via the npm wrapper:
npm install @aimino/syntaro-mcp
npx syntaro-mcp stdio
```

## Run

```bash
# stdio (OpenCode / Claude Desktop integration)
python -m syntaro_mcp.server stdio

# SSE (remote agents)
python -m syntaro_mcp.server sse --host 0.0.0.0 --port 4095

# SSE over TLS
python -m syntaro_mcp.server sse --ssl-keyfile key.pem --ssl-certfile cert.pem
```

Set `PYTHONPATH` to the repo root so `workers.pipeline_client` resolves.

## Environment

| Variable | Purpose |
|----------|---------|
| `SYMPHONY_LINEAR_API_KEY` / `LINEAR_API_KEY` | Linear API key (raw value — Linear rejects a `Bearer ` prefix) |
| `SLACK_BOT_TOKEN` | Slack bot token for `slack_send` |
| `MEMORY_DIR` | Directory for `memory_read`/`memory_write` files (default `/tmp/symphony-workspaces/memory`) |
| `GITHUB_TOKEN` / `GITHUB_APP_PRIVATE_KEY` | GitHub auth for labeling issues |
| `SYNTARO_API_URL`, `SYNTARO_API_KEY` | SYNTARO backend fallback for fix runs |

## OpenCode integration

```json
{
  "mcp": {
    "syntaro": {
      "type": "local",
      "command": ["python3", "-m", "syntaro_mcp.server", "stdio"],
      "environment": { "PYTHONPATH": "/path/to/solving_tickets_as_a_service" }
    }
  }
}
```

## License

AGPL-3.0-only — free for public/open-source use; part of the SYNTARO traction play.
