# Glama.ai MCP Server Listing Guide

## Overview

[Glama.ai](https://glama.ai) is a marketplace for MCP servers. Submitting
@aimino/syntaro-mcp here provides additional discoverability beyond the MCP
Registry and Smithery.

## Prerequisites

- [ ] Glama.ai account (sign up at https://glama.ai)
- [ ] Published npm package `@aimino/syntaro-mcp` (subtask 1)
- [ ] Active MCP server endpoint (SSE or Streamable HTTP)

## Submission Steps

### 1. Navigate to Glama MCP Servers

Go to https://glama.ai/mcp/servers and click "Add Server".

### 2. Enter Server Details

Use the following values exactly:

| Field | Value |
|-------|-------|
| Name | `@aimino/syntaro-mcp` |
| Description | SYNTARO (Solving Tickets As A Service) — label a GitHub issue and get an automated fix PR. Open-source AI bot backed by OpenCode. |
| Homepage | https://github.com/Aimino-Tech/solving_tickets_as_a_service |
| License | AGPL-3.0 |
| Categories | Developer Tools, Code Quality, Automation |

### 3. Configure Transport

**Option A — npm install (stdio):**

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

**Option B — Remote SSE endpoint:**

```json
{
  "mcpServers": {
    "syntaro": {
      "url": "https://your-syntaro-instance.example.com/sse"
    }
  }
}
```

### 4. Add Tool Definitions (Optional)

Glama will auto-discover tools from the server, but you can pre-populate:

| Tool | Description |
|------|-------------|
| `syntaro_label_issue` | Label a GitHub issue with the SYNTARO fix label |
| `syntaro_run_fix` | Trigger the SYNTARO fix pipeline for a GitHub issue |
| `syntaro_check_status` | Check fix run status |
| `syntaro_get_pr` | Get PR URL and details |
| `list_issues` | List tracked issues |
| `search_codebase` | Search repository codebase |

### 5. Submit for Review

Click "Submit" and wait for Glama approval (typically 1-3 business days).

## Verification

1. Search for "syntaro" or "@aimino/syntaro-mcp" on Glama
2. Verify listing shows correct description, tools, and install instructions
3. Test the "Try it" button if available

## Updating

Push updates to the npm package; Glama will re-index on the next scheduled scan.
For urgent updates, re-submit via the Glama dashboard.
