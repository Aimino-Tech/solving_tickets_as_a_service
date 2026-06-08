# Day 2 — Reddit r/MCP Post
## Technical Deep-Dive: Building a 4-Tier MCP Server for HTML Generation

---

**Target:** r/MCP
**Title:** I built an open-source MCP server with 4 tiers (Assembly, Patch, Read, Raw) for AI-driven HTML generation — here's the architecture

**Target:** r/selfhosted
**Title:** Self-host your own HTML MCP server — 9 tools, 15 components, 10 templates

---

# I built an open-source MCP server with 4 tiers for AI-driven HTML generation

I've been working with MCP since the spec was announced, and one pattern kept bothering me: most servers are single-purpose tools. One tool, one job. But real development workflows are iterative — you create, review, edit, refine. A single `write_file` tool doesn't capture that.

So I built [OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD) — a 4-tier, 9-tool MCP server for HTML generation.

## Architecture

```
OpenTalk2HTML-NotMD
├── Assembly Tier   → render_page       Compose pages from structured component specs
├── Patch Tier      → patch_html         Replace content via CSS selectors
│                   → set_attribute      Set element attributes
├── Read Tier       → read_html          Analyze existing HTML (3 modes)
├── Raw Tier        → write_raw_html     Write HTML string to file
│                   → write_html_file    Alias for write_raw_html
│                   → format_html        Beautify HTML in-place
│                   → preview_html       Render HTML to preview file
└── Utilities       → list_components    List 15 built-in components with props
                    → list_templates     List 10 templates
```

## Why 4 Tiers?

**Assembly** — The AI describes a page using component specs (header, hero, data-table, tabs, etc.) and selects a template. The server composes the HTML. One call, complete page.

**Patch** — HTML iteration is rarely "write once, done." `patch_html` uses CSS selectors to target specific elements and replace their inner content. `set_attribute` updates individual attributes. No full-page regeneration.

**Read** — Before editing, the agent needs to understand what exists. `read_html` supports three output modes — structure (DOM tree), content (extracted text), compressed (minified). This lets the agent make informed edits.

**Raw** — Escape hatch. Direct file writes, formatting, and browser preview when you need full control.

## Components (15)

Layout: `header`, `footer`, `sidebar`, `card-deck`, `grid`
Interactive: `tabs`, `accordion`
Data: `data-table`, `stats-grid`, `timeline`
Media: `figure`, `image-gallery`
Utility: `hero`, `callout`, `code-block`

## Templates (10)

`report`, `exploration`, `deck`, `code-review`, `design`, `prototyping`, `illustrations`, `research`, `custom-editor`, `minimal`

## Technical Details

- **Language:** TypeScript, compiled to Node.js
- **Runtime:** Node >=20
- **SDK:** Official `@modelcontextprotocol/sdk` (stdio transport)
- **Package:** `@aimino/opentalk2html-notmd` on npm
- **License:** Apache 2.0

## Self-Hosting Setup

```bash
git clone https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD.git
cd OpenTalk2HTML-NotMD
npm install
npm run build
npm run dev    # hot reload via tsx
npm test       # vitest
```

Or run directly with npx:

```bash
npx @aimino/opentalk2html-notmd
```

## MCP Client Config

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

## Design Decisions

1. **Tiered tools over monoliths** — Each tool does one thing well. The tiers map to real workflow stages.
2. **stdio transport** — Zero network config required. Works everywhere MCP clients expect it.
3. **Components over templates** — 15 reusable components + 10 templates = combinatorial variety without complexity.
4. **CSS selector patching** — Standard web technology. No custom DSL to learn.
5. **Read modes** — Structure, content, and compressed views give AI agents the right level of context.

## Security

- Filesystem writes respect OS permissions
- No network calls from the server itself
- Path handling uses Node.js `path` module (no traversal vulnerabilities)
- The AI client controls all content

**Repo:** [github.com/Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)

Happy to discuss architectural decisions in the comments. I believe this tiered pattern (especially Assembly + Patch for iterative workflows) could apply to many MCP use cases beyond HTML.
