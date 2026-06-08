# r/MCP Post — Draft

## Title
I built an MCP server that assembles HTML in <10ms — first dedicated HTML generation server for AI agents

## Body

I've been using MCP for a while, and one gap kept bugging me: there was no server purpose-built for generating HTML. Playwright can render pages (slow), Filesystem can write files (no composability), Fetch can grab URLs (read-only). Nothing to *compose* HTML from components at speed.

So I built opentalk2html-notmd.

**Four tiers, 9 tools, 15 components, 10 templates:**

| Tier | Tools | What |
|---|---|---|
| Assembly | render_page | Compose pages from components + templates — sub-10ms |
| Patch | patch_html, set_attribute | Edit HTML via CSS selectors — under 5ms |
| Read | read_html | Analyze HTML in 3 modes |
| Raw | write_raw_html, format_html, preview_html | Low-level file ops |

**Components:** header, footer, sidebar, card-deck, grid, tabs, accordion, data-table, stats-grid, timeline, figure, image-gallery, hero, callout, code-block

**Templates:** report, exploration, deck, code-review, design, prototyping, illustrations, research, custom-editor, minimal

**Why it matters:**
If your AI agent builds 20+ pages in a workflow, sub-10ms vs 2-3 seconds per page is the difference between instant and useless. The Patch tier lets agents iterate on pages without rebuilding from scratch — like jQuery for AI.

**Quick start:**
```bash
npx @aimino/opentalk2html-notmd
```

Or in your MCP config:
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

Open source (Apache 2.0). Works with Claude Desktop, Cursor, VS Code, Claude Code.

GitHub: https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD

I'd love feedback — especially from anyone building agentic workflows that need UI output. What's your current approach for HTML generation at scale?

---

## Posting instructions
1. Go to https://old.reddit.com/r/MCP/submit
2. Title: paste from above
3. Body: paste from above
4. Complete captcha
5. Hit submit
6. Send me the post URL
