# Day 1 — X Launch Thread (10 tweets)

---

**Tweet 1/10**
I built an open-source MCP server with 9 tools across 4 tiers — Assembly, Patch, Read, Raw — for AI agents to generate, edit, and analyze HTML directly on your filesystem.

No copy-paste. No manual saves. Just instant HTML generation. 🧵👇

**Tweet 2/10**
The problem with AI-generated HTML today:
1. AI writes markup
2. You copy it
3. You paste into a file
4. You save
5. You open in browser
6. You need changes
7. Repeat

This loop costs 30-45 seconds per iteration. Across a session: 10+ minutes wasted.

**Tweet 3/10**
I built opentalk2html-notmd to fix this. An open-source MCP server that gives AI agents structured HTML generation:

🧩 Assembly Tier → compose full pages from components + templates
✏️ Patch Tier → edit via CSS selectors
🔍 Read Tier → analyze existing HTML
📝 Raw Tier → write, format, preview

**Tweet 4/10**
The Assembly Tier is the game-changer: 15 built-in components (hero, data-table, tabs, accordion, galleries...) + 10 templates (report, deck, prototyping, research...).

The AI describes the page structure. The server assembles it instantly.

**Tweet 5/10**
Built with TypeScript, runs on Node.js (>=20). Uses the official MCP SDK with stdio transport.

Compatible with every MCP client out of the box:
• Claude Desktop ✅
• Cursor ✅
• VS Code + Continue.dev ✅
• Any MCP host ✅

**Tweet 6/10**
Quick start:
```bash
npx @aimino/opentalk2html-notmd
```

Add to your MCP config and your AI agent can write HTML to disk directly. No API keys. No cloud dependency. Just Node.js and your local machine.

**Tweet 7/10**
Why I built this as a 4-tier system instead of a single "write file" tool:

Most HTML generation tools treat the output as a blob. But real development is iterative — you assemble, read, edit, and refine. Each tier maps to a real workflow stage. Structured tools beat catch-alls.

**Tweet 8/10**
15 components out of the box:
• Layout: header, footer, sidebar, card-deck, grid
• Interactive: tabs, accordion
• Data: data-table, stats-grid, timeline
• Media: figure, image-gallery
• Utility: hero, callout, code-block

All usable through the `render_page` tool with any of 10 templates.

**Tweet 9/10**
This is open source — Apache 2.0. PRs, issues, feature requests welcome on GitHub.

If you've ever wished your AI agent could just *write the HTML file* and even *edit it afterward* — this is your project.

**Tweet 10/10**
MCP is changing how AI agents interact with developer tools. OpenTalk2HTML-NotMD is one piece of that puzzle — giving AI structured access to the most fundamental dev tool there is: the filesystem.

⭐ [github.com/Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)

Try it. Break it. Ship something with it. 🚀
