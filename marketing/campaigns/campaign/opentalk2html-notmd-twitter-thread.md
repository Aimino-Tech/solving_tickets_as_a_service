# X/Twitter Thread — Draft

## Tweet 1 🧵
I built an MCP server that generates HTML in under 10ms.
Not "renders." Not "fetches." Actually *composes* HTML from components.
Here's how it works and why it matters ↓

## Tweet 2
The problem: AI agents that need to output UI have no dedicated MCP tool.
→ Playwright is a browser (slow, heavy)
→ Filesystem is raw (no composability)
→ Fetch is read-only

So I built a four-tier architecture specifically for HTML generation.

## Tweet 3
**Assembly tier** — render_page
15 components + 10 templates. Sub-10ms.
Your AI can build a full page faster than you can type "npx."

## Tweet 4
**Patch tier** — patch_html + set_attribute
Edit rendered HTML via CSS selectors. Under 5ms.
Think jQuery for AI agents. Your agent iterates without rebuilding from scratch.

## Tweet 5
**Read tier** — read_html
Analyze existing HTML in 3 modes.
**Raw tier** — write_raw_html, format_html, preview_html
Full control when you need it.

## Tweet 6
Open source (Apache 2.0). Works with Claude Desktop, Cursor, VS Code, Claude Code.

One command:
```
npx @aimino/opentalk2html-notmd
```

GitHub: github.com/Aimino-Tech/OpenTalk2HTML-NotMD

## Tweet 7
If you build agentic workflows that need UI output — I'd love your feedback. What's your current approach? What's missing?

This is the first dedicated HTML generation MCP server. Let's make it better together. 🚀

---

## Posting instructions
- Post tweets 1-7 in order (or combine into fewer tweets)
- Tag relevant accounts: @AnthropicAI, @ClaudeCode, @cursor_ai
- Best time: 12-2pm PT (dev hours)
- Send me the link so I can engage in replies
