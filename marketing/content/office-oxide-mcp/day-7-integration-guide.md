# Day 7 — Integration Guide Thread (6 tweets)

---

**Tweet 1/6**
How to integrate office-oxide-mcp with your AI agent.

Works with every major MCP client. Here's the exact config for each. 🧵

**Tweet 2/6**
Claude Desktop:
```json
{
  "mcpServers": {
    "office-oxide-mcp": {
      "command": "npx",
      "args": ["@aimino/office-oxide-mcp"]
    }
  }
}
```
Restart Claude. Your agent can now read, write, and convert Office files.

**Tweet 3/6**
Cursor:
Settings → MCP → Add Server:
- Name: office-oxide-mcp
- Type: command
- Command: npx @aimino/office-oxide-mcp

Then in chat: "Read this Excel file and summarize the data" → agent calls `read_document` → returns structured content.

**Tweet 4/6**
VS Code + Continue.dev:
```json
{
  "mcpServers": {
    "office-oxide-mcp": {
      "command": "npx",
      "args": ["@aimino/office-oxide-mcp"]
    }
  }
}
```
Works with any MCP host — Claude Code, Cline, Roo Code, and more.

**Tweet 5/6**
Available MCP tools:
• `read_document` — parse DOCX/XLSX/PPTX → structured text
• `write_document` — create Office files from JSON
• `convert_document` — between any supported format
• `query_document` — targeted extraction (specific sheets, slides)
• `list_formats` — show all supported input/output types

Each tool returns clean, structured data — no raw HTML or markdown to parse.

**Tweet 6/6**
Try it yourself:

1. Install: `npx @aimino/office-oxide-mcp`
2. Add to MCP client config
3. Ask your agent: "Create a spreadsheet from this data"

All local. All fast. All open source.

⭐ [github.com/Aimino-Tech/office-oxide-mcp](https://github.com/Aimino-Tech/office-oxide-mcp)
