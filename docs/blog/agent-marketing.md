# How AI Agents Can Use STAS to Fix GitHub Issues Autonomously

**Published:** July 17, 2026
**Author:** Aimino Tech
**Tags:** `agent-to-agent`, `mcp`, `ai-agents`, `stas`, `opencode`, `automation`

---

## The Vision: Agent-to-Agent Marketing

In the emerging world of AI agents, the most successful tools won't be those marketed to humans — they'll be those discovered and installed by agents themselves. This is **agent-to-agent marketing**, and STAS (Solving Tickets As A Service) is leading the charge.

STAS is now fully discoverable by AI agents across multiple registries and protocols. Here's how agents find, install, and use STAS — and how you can too.

---

## How Agents Discover STAS

### 1. MCP Registry Discovery

The Model Context Protocol (MCP) defines a standard for AI agents to discover and connect with tools. STAS publishes a well-known discovery endpoint:

```
GET /.well-known/mcp-server-card.json
```

Any MCP-compatible agent (Claude Desktop, Cursor, Windsurf, etc.) that encounters a STAS deployment can read this card and immediately understand STAS's capabilities — what tools it exposes, what resources it provides, and how to connect.

### 2. Smithery.ai

Smithery is the app store for MCP servers. STAS is listed at [smithery.ai/server/@aimino/stas-mcp](https://smithery.ai/server/@aimino/stas-mcp) with one-click install. Agents browsing Smithery can add STAS without any manual configuration.

### 3. npm Registry

STAS is published as `@aimino/stas-mcp` on npm. Any agent with npm access can install and run STAS as a stdio MCP server:

```bash
npx -y @aimino/stas-mcp
```

### 4. skills.sh / OpenCode Skills

For OpenCode and OpenClaw agents, STAS is available as a skill:

```bash
npx skills add Aimino-Tech/solving_tickets_as_a_service
```

This auto-installs the STAS skill and makes its tools available to the agent.

---

## One-Line Setup Per Agent Type

### OpenCode

```bash
npx skills add Aimino-Tech/solving_tickets_as_a_service
```

Or add to `opencode.json`:

```json
{
  "name": "stas-agent",
  "transport": "stdio",
  "command": "python",
  "args": ["-m", "mcp.stas_mcp", "stdio"]
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stas": {
      "command": "npx",
      "args": ["-y", "@aimino/stas-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "stas": {
      "command": "npx",
      "args": ["-y", "@aimino/stas-mcp"]
    }
  }
}
```

### Codex CLI

```bash
npx -y @aimino/stas-mcp
```

---

## The Agent-to-Agent Loop

Here's how the viral discovery loop works:

```
1. Agent A discovers STAS → Installs via MCP/Smithery/npm
2. Agent A uses STAS to fix issues → Creates PRs
3. PRs include "Agent Found STAS" badge → Human sees badge
4. Human installs STAS on their repo → STAS discovers more agents
5. Agent B discovers STAS on shared repo → Repeat cycle
```

This creates a **compounding network effect**: every PR created by STAS becomes a marketing channel, advertising STAS's capabilities to both humans and other agents.

---

## Available Tools for Agents

Once connected, agents can use these tools:

| Tool | Description |
|---|---|
| `stas_label_issue` | Label a GitHub issue with `stas:fix` to trigger the pipeline |
| `stas_run_fix` | Submit a GitHub issue URL for automated fixing |
| `stas_check_status` | Poll fix run status by `run_id` |
| `stas_get_pr` | Retrieve PR details for a completed fix |
| `list_issues` | List tracked issues and their STAS fix status |
| `search_codebase` | Search the STAS codebase for symbols/patterns |

---

## The "Agent Found STAS" Badge

Every repo that uses STAS can add the "Agent Found STAS" badge to its README:

```markdown
[![Agent Found STAS](https://img.shields.io/badge/Agent_Found-STAS-8250DF)](https://stas.aimino.io/agents.html)
```

This badge tells other agents (and humans) that the repo is STAS-enabled, creating a visible network effect.

---

## Why This Matters

**Agent-to-agent marketing** is the next evolution of developer tools. Instead of advertising to developers on social media, STAS advertises to agents in registries. Agents try STAS, produce results, and those results become discoverable by other agents.

This creates a self-sustaining growth loop:

1. **Discovery**: Agents find STAS in MCP registries, Smithery, npm, skills.sh
2. **Installation**: One-line install per agent type
3. **Production**: Agent uses STAS to fix GitHub issues
4. **Viral Loop**: PRs include badges → more agents discover → more usage

---

## Get Started

To add STAS to your agent:

```bash
# OpenCode / skills.sh
npx skills add Aimino-Tech/solving_tickets_as_a_service

# Any MCP-compatible agent
npx -y @aimino/stas-mcp
```

Or visit [stas.aimino.io/agents.html](https://stas.aimino.io/agents.html) for the full guide.

---

*STAS — Solving Tickets As A Service. Label a GitHub issue. Get a pull request. Now with full AI agent support.*
