# Day 11 — X Integration Spotlight Thread

---

**Tweet 1/6**
Office-oxide-mcp works with every major MCP client. Here's how to set it up with the tools you probably already use. 🧵

**Tweet 2/6**
Claude Desktop:
```json
{
  "mcpServers": {
    "office-oxide-mcp": {
      "command": "npx",
      "args": ["office-oxide-mcp"]
    }
  }
}
```
Claude can now read your spreadsheets and edit your Word docs. Ask it to "find the Q3 revenue in my financial report.xlsx" and it just works.

**Tweet 3/6**
Claude Code / Cursor:
```json
{
  "mcpServers": {
    "office-oxide-mcp": {
      "command": "npx",
      "args": ["-y", "office-oxide-mcp"]
    }
  }
}
```
Your coding agent can access project documentation, read spec sheets, and update changelogs. No more copy-pasting between docs and your editor.

**Tweet 4/6**
VS Code + Continue.dev:
```json
{
  "experimental": {
    "mcpServers": {
      "office-oxide-mcp": {
        "command": "npx",
        "args": ["office-oxide-mcp"]
      }
    }
  }
}
```
Your IDE agent can pull data from Excel workbooks, read requirements from Word docs, and generate PDF reports — all without leaving your editor.

**Tweet 5/6**
Custom agent (any MCP host):
```python
# Just add the MCP server config
mcp_servers = {
    "office-oxide-mcp": {
        "command": "npx",
        "args": ["office-oxide-mcp"]
    }
}
```
Your custom agent gets 8 document-processing tools automatically. Read, write, search, edit — all through the same MCP protocol your server already speaks.

**Tweet 6/6**
The MCP protocol means one server, any client. Write once, use everywhere.

Whether you're in Claude Desktop, VS Code, Cursor, or a custom agent — office-oxide-mcp works the same way. Same tools. Same performance. Same zero-config setup.

⭐ github.com/Aimino-Tech/office-oxide-mcp
