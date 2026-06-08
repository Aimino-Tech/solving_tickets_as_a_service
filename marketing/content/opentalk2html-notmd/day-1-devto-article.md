# Day 1 — Dev.to Article
## OpenTalk2HTML-NotMD: 9 Tools, 4 Tiers — Open-Source HTML Generation for AI Agents

---

**Target:** Dev.to
**Tags:** mcp, opensource, html, ai, webdev, typescript
**Series:** Building in Public
**Canonical:** https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD

---

# OpenTalk2HTML-NotMD: 9 Tools, 4 Tiers — Open-Source HTML Generation for AI Agents

Every developer who uses AI coding assistants to generate HTML knows the loop:

1. AI generates markup
2. You copy it
3. You create a file
4. You paste, save, open in browser
5. You need changes
6. Repeat 1–6

That's 20–45 seconds of mechanical overhead per iteration. Across a session of 20–30 components, **10+ minutes of pure friction**.

I built [OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD) to kill that loop entirely. It's an open-source MCP server with **9 tools across 4 tiers** — Assembly, Patch, Read, and Raw — giving AI agents complete, structured access to HTML generation on your filesystem.

## The Architecture

```
OpenTalk2HTML-NotMD
├── Assembly Tier    →  render_page          Compose pages from components + templates
├── Patch Tier       →  patch_html           Edit existing HTML via CSS selectors
│                    →  set_attribute        Set attributes on matched elements
├── Read Tier        →  read_html            Analyze HTML files (structure, content, compressed)
├── Raw Tier         →  write_raw_html       Write raw HTML to file
│                    →  write_html_file      Alias for write_raw_html
│                    →  format_html          Beautify HTML in-place
│                    →  preview_html         Render HTML to preview file
└── Utilities        →  list_components      Discover available components
                     →  list_templates        Discover available templates
```

### Assembly Tier — `render_page`
The crown jewel. Pass a structured component spec and a template name, and the server composes a full page from **15 built-in components**:

**Layout:** `header`, `footer`, `sidebar`, `card-deck`, `grid`
**Interactive:** `tabs`, `accordion`
**Data:** `data-table`, `stats-grid`, `timeline`
**Media:** `figure`, `image-gallery`
**Utility:** `hero`, `callout`, `code-block`

Choose from **10 templates**: `report`, `exploration`, `deck`, `code-review`, `design`, `prototyping`, `illustrations`, `research`, `custom-editor`, `minimal`.

The AI describes the page structure, and the server assembles it instantly.

### Patch Tier — Edit Without Regenerating
Made a tweak? Instead of regenerating the entire page, use `patch_html` to replace inner content of any element via CSS selector, or `set_attribute` to update attributes. No full rewrites — just surgical edits.

### Read Tier — Understand What Exists
`read_html` analyzes existing HTML files in three modes: structure (tag tree), content (extracted text), or compressed. Perfect for AI agents that need to understand existing pages before modifying them.

### Raw Tier — Full Control
When you need total control: `write_raw_html` / `write_html_file` for direct writes, `format_html` to beautify, and `preview_html` to render and open in a browser.

## Quick Start

```bash
npx @aimino/opentalk2html-notmd
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "opentalk2html-notmd": {
      "command": "npx",
      "args": ["-y", "@aimino/opentalk2html-notmd"]
    }
  }
}
```

That's it. One command. Your AI agent can now write, read, patch, and assemble HTML directly on your filesystem.

## Why This Matters

The MCP ecosystem is growing fast, but most servers focus on API integrations — databases, cloud services, productivity tools. This one focuses on **the most fundamental developer tool: the filesystem**.

By giving AI agents structured access to HTML generation — not just raw file writes but assembly, patching, and reading — we move from "AI as chat partner" to "AI as developer collaboration partner."

## Stack

- **TypeScript** — compiled to Node.js, Node >=20
- **Official MCP SDK** — stdio transport, compatible with any MCP client
- **Vitest** — test suite
- **`tsx`** — hot reload during development

## Try It

```
npx @aimino/opentalk2html-notmd
```

Configure in Claude Desktop, Cursor, VS Code + Continue.dev, or any MCP host. Once connected, your AI agent can generate, read, patch, and assemble HTML at filesystem speed.

**[GitHub: Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)** — Star it if you build with AI.

---

*Built with TypeScript for the open-source AI community. Apache 2.0 license.*
