# SYNTARO MCP Server — API Reference

## Overview

SYNTARO (Solving Tickets As A Service) exposes an MCP (Model Context Protocol) server that allows AI agents and MCP-compatible clients to submit GitHub issues for automated fixing and track their progress.

## Installation

```bash
npx -y @aimino/syntaro-mcp
```

Or install globally:

```bash
npm install -g @aimino/syntaro-mcp
syntaro-mcp
```

## Transport Modes

| Mode | Description | Default Port |
|------|-------------|-------------|
| stdio | Standard input/output for local agent integration | — |
| SSE | Server-Sent Events for remote connections | 4095 |
| Streamable HTTP | HTTP-based streaming transport | 4095 |

### Stdio Mode

```bash
npx -y @aimino/syntaro-mcp stdio
```

### SSE Mode

```bash
npx -y @aimino/syntaro-mcp sse
```

### Streamable HTTP Mode

```bash
npx -y @aimino/syntaro-mcp streamable-http
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNTARO_MCP_PORT` | `4095` | Port for SSE/HTTP transport |
| `SYNTARO_API_URL` | `https://api.syntaro.io` | SYNTARO API backend URL |
| `SYNTARO_API_KEY` | — | API key for SYNTARO backend authentication |

## Tools

### syntaro_label_issue

Label a GitHub issue with the SYNTARO fix label.

**Parameters:**
- `owner` (string, required) — GitHub repository owner
- `repo` (string, required) — GitHub repository name
- `issue_number` (integer, required) — Issue number to label
- `label` (string, optional, default: `syntaro:fix`) — Label name

### syntaro_run_fix

Trigger the SYNTARO fix pipeline for a GitHub issue URL.

**Parameters:**
- `issue_url` (string, required) — Full GitHub issue URL

### syntaro_check_status

Check the current status of a SYNTARO fix run by run_id.

**Parameters:**
- `run_id` (string, required) — Run identifier from syntaro_run_fix

### syntaro_get_pr

Get the PR URL and details for a completed SYNTARO fix run.

**Parameters:**
- `run_id` (string, required) — Run identifier

### list_issues

List tracked issues and their SYNTARO fix status.

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
  "apiKey": "your-syntaro-api-key"
}
```

## Client Configuration

### OpenCode

```json
{
  "mcpServers": {
    "syntaro": {
      "command": "npx",
      "args": ["-y", "@aimino/syntaro-mcp", "stdio"]
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "syntaro": {
      "command": "npx",
      "args": ["-y", "@aimino/syntaro-mcp", "stdio"]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "syntaro": {
      "command": "npx",
      "args": ["-y", "@aimino/syntaro-mcp", "stdio"]
    }
  }
}
```
