# Day 4 — Show HN Post
## Show HN: OpenTalk2HTML-NotMD — 4-Tier, 9-Tool Open-Source MCP Server for HTML Generation

---

**Target:** Hacker News (Show HN)

---

Show HN: OpenTalk2HTML-NotMD — I built a 4-tier, 9-tool MCP server that lets AI agents assemble, read, patch, and write HTML directly to your filesystem

You know the drill when using Claude, Cursor, or any AI assistant to generate HTML:

1. AI generates markup
2. You copy it
3. You create a file
4. You paste, save, open in browser
5. It needs changes
6. Repeat

That's 30-45 seconds of overhead per iteration. For a session with 20 refinements, that's 10+ minutes of mechanical work.

I built [opentalk2html-notmd](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD) to eliminate this entirely. It's an open-source MCP server with 9 tools across 4 tiers:

**Assembly:** `render_page` — compose full pages from 15 built-in components (hero, data-table, tabs, accordion, galleries, etc.) using 10 templates (report, prototyping, research, deck, etc.)

**Patch:** `patch_html` — replace content via CSS selectors. `set_attribute` — update individual attributes. No full-page regenerations for small changes.

**Read:** `read_html` — analyze existing HTML in 3 modes: structure (DOM tree), content (extracted text), or compressed. AI agents can understand existing pages before modifying them.

**Raw:** `write_raw_html`, `write_html_file`, `format_html`, `preview_html` — full control when you need it.

Why 4 tiers? Because real development is iterative: assemble → review → edit → preview → refine. Each tier maps to a real workflow stage.

```
npx @aimino/opentalk2html-notmd
```

Works with Claude Desktop, Cursor, VS Code + Continue.dev, and any MCP client. TypeScript, Node >=20, Apache 2.0.

[GitHub: Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)

I'd love feedback from the HN community on the 4-tier architecture approach. Does the Assembly + Patch separation make sense for your workflow? What's your current process for AI-generated HTML?
