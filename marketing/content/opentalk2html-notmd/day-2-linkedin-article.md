# Day 2 — LinkedIn Article
## Building an Open-Source MCP Server for AI-Assisted HTML Generation

---

**Target:** LinkedIn
**Format:** Long-form article

---

# Building an Open-Source MCP Server for AI-Assisted HTML Generation

Every developer using AI coding assistants knows the friction. The AI generates beautiful HTML. You copy it. You save it. You preview. You ask for changes. You copy again. You save again.

After the 50th iteration of this dance, I realized this is a fundamental UX problem — and the Model Context Protocol (MCP) is the perfect solution.

## The 4-Tier Approach

Most MCP servers expose 1-2 simple tools. For OpenTalk2HTML-NotMD, I took a different approach: **4 tiers, 9 tools** — each mapping to a real stage in the HTML development workflow.

**Assembly Tier** — The AI describes a page structure using component specs (header, hero, data-table, footer, etc.) and a template name. The server composes the full page from 15 built-in components across 10 templates. One tool: `render_page`.

**Patch Tier** — HTML is rarely right on the first try. Instead of regenerating entire pages, `patch_html` replaces content via CSS selectors, and `set_attribute` updates individual attributes. Surgical edits. No full rewrites.

**Read Tier** — AI agents need to understand existing code before modifying it. `read_html` analyzes HTML files in three modes: structure (tag tree), content (extracted text), or compressed. Context without clutter.

**Raw Tier** — When you need direct control: write raw HTML, format existing files, preview in browser. Complete flexibility when the structured tiers aren't enough.

## Why This Matters for the MCP Ecosystem

The MCP ecosystem has grown explosively, but most servers focus on API integrations — connecting AI to SaaS tools, databases, and cloud services. OpenTalk2HTML-NotMD focuses on something more fundamental: **the developer's filesystem**.

This shift — from AI as chat partner to AI as code collaborator — requires tools that understand development workflows, not just API calls. A 4-tier architecture mirrors how developers actually work: assemble, read, patch, refine.

## Technical Stack

- **TypeScript** on Node.js (>=20)
- **Official MCP SDK** with stdio transport
- **Vitest** for testing
- **`tsx`** for hot-reload development

The server is distributed via npm as `@aimino/opentalk2html-notmd`. Run it with a single `npx` command.

## Open Source

Released under Apache 2.0 on GitHub. The project includes:
- The full MCP server implementation
- 15 production-ready HTML components
- 10 page templates
- Complete test suite
- MCP client config examples

## Get Started

```bash
npx @aimino/opentalk2html-notmd
```

Configure once in your MCP client. Your AI assistant can then assemble, read, patch, and write HTML directly to your filesystem.

**[github.com/Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)**

If you build web interfaces with AI assistance, give it a try. A GitHub star helps the project grow.

---

*Building in public. Apache 2.0. TypeScript. Opinions are my own.*
