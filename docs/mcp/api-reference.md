# STAS MCP Server — API Reference

## Overview

STAS (Solving Tickets As A Service) exposes an MCP (Model Context Protocol) server that allows AI agents and MCP-compatible clients to submit GitHub issues for automated fixing and track their progress.

## Installation

```bash
npx -y @aimino/stas-mcp
```

Or install globally:

```bash
npm install -g @aimino/stas-mcp
stas-mcp
```

## Transport Modes

| Mode | Description | Default Port |
|------|-------------|-------------|
| stdio | Standard input/output for local agent integration | — |
| SSE | Server-Sent Events for remote connections | 4095 |
| Streamable HTTP | HTTP-based streaming transport | 4095 |

### Stdio Mode

```bash
npx -y @aimino/stas-mcp stdio
```

### SSE Mode

```bash
npx -y @aimino/stas-mcp sse
```

### Streamable HTTP Mode

```bash
npx -y @aimino/stas-mcp streamable-http
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_MCP_PORT` | `4095` | Port for SSE/HTTP transport |
| `STAS_API_URL` | `http://localhost:3000` | STAS API backend URL |
| `STAS_API_KEY` | — | API key for STAS backend authentication |

## Tools

### stas_label_issue

Label a GitHub issue with the STAS fix label.

**Parameters:**
- `owner` (string, required) — GitHub repository owner
- `repo` (string, required) — GitHub repository name
- `issue_number` (integer, required) — Issue number to label
- `label` (string, optional, default: `stas:fix`) — Label name

### stas_run_fix

Trigger the STAS fix pipeline for a GitHub issue URL.

**Parameters:**
- `issue_url` (string, required) — Full GitHub issue URL

### stas_check_status

Check the current status of a STAS fix run by run_id.

**Parameters:**
- `run_id` (string, required) — Run identifier from stas_run_fix

### stas_get_pr

Get the PR URL and details for a completed STAS fix run.

**Parameters:**
- `run_id` (string, required) — Run identifier

### list_issues

List tracked issues and their STAS fix status.

**Parameters:**
- `status` (string, optional) — Filter by status
- `repo` (string, optional) — Filter by repository
- `limit` (integer, optional, default: 20, max: 100) — Maximum results

### search_codebase

Search the repository codebase for relevant context.

**Parameters:**
- `query` (string, required) — Search query
- `owner` (string, required) — Repository owner
- `repo` (string, required) — Repository name

## Authentication

When connecting to the SSE or Streamable HTTP transport, include the API key:

```json
{
  "apiKey": "your-stas-api-key"
}
```

## Client Configuration

### OpenCode

```json
{
  "mcpServers": {
    "stas": {
      "command": "npx",
      "args": ["-y", "@aimino/stas-mcp", "stdio"]
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "stas": {
      "command": "npx",
      "args": ["-y", "@aimino/stas-mcp", "stdio"]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "stas": {
      "command": "npx",
      "args": ["-y", "@aimino/stas-mcp", "stdio"]
    }
  }
}
```
