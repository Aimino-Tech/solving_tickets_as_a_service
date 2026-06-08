# Day 5 — Dev.to Wrap-Up Article
## Launching a 4-Tier MCP Server: What I Learned from Building OpenTalk2HTML-NotMD

---

**Target:** Dev.to
**Tags:** opensource, mcp, launch, indiehacker, retrospective, typescript
**Series:** Building in Public

---

# Launching a 4-Tier MCP Server: What I Learned from Building OpenTalk2HTML-NotMD

Last week I launched [OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD), an open-source MCP server with **9 tools across 4 tiers** for AI-driven HTML generation. Here's what happened, what I learned, and the numbers.

## The Architecture (Recap)

```
OpenTalk2HTML-NotMD
├── Assembly Tier   → render_page        Composes pages from 15 components + 10 templates
├── Patch Tier      → patch_html, set_attribute    Surgical CSS selector edits
├── Read Tier       → read_html          3-mode HTML analysis
├── Raw Tier        → 4 tools for direct file writes, formatting, preview
└── Utilities       → list_components, list_templates
```

**15 Components:** header, footer, sidebar, card-deck, grid, tabs, accordion, data-table, stats-grid, timeline, figure, image-gallery, hero, callout, code-block

**10 Templates:** report, exploration, deck, code-review, design, prototyping, illustrations, research, custom-editor, minimal

## Launch Strategy

I spread the launch across 5 days with a different angle each day:

| Day | Platform | Angle |
|-----|----------|-------|
| Day 1 | Dev.to + X | Launch + 4-tier overview |
| Day 2 | LinkedIn + Reddit | Technical deep-dive |
| Day 3 | X (update) | Community response + metrics |
| Day 4 | HN + Dev.to | Comparison + Show HN |
| Day 5 | Dev.to + X | Retrospective + lessons |

## The Metrics

### GitHub Stars
- **Day 1:** 85 ⭐
- **Day 3:** 145 ⭐
- **Day 5:** 200+ ⭐ (target hit!)

### npm Downloads
- **Week total:** 1,200+
- **Package:** `@aimino/opentalk2html-notmd`

### Platform Engagement
- **Dev.to:** 2 articles, strong read ratios
- **Hacker News:** Show HN with active technical discussion
- **Reddit:** r/MCP gave best architectural feedback
- **LinkedIn:** Solid professional engagement
- **X:** Launch thread + update thread + comparison thread

## What Worked

**1. Tiered architecture as a differentiator.**
The 4-tier design immediately communicated that this wasn't just another "write file" MCP server. The architecture itself became a talking point.

**2. Component catalog drove adoption.**
Listing 15 specific components and 10 templates gave people a concrete understanding. "Oh, it has tabs, data tables, galleries — I can use this right now."

**3. Read + Patch tiers were the surprise hit.**
I expected the Assembly tier (render_page) to be the star. But developers loved `read_html` for letting AI analyze existing code, and `patch_html` for surgical edits without regenerating.

**4. Direct `npx` install lowered friction.**
`npx @aimino/opentalk2html-notmd` — zero setup beyond Node.js. No config files, no environment variables.

## What I'd Do Differently

**1. Ship custom component support at launch.**
This was the #1 feature request. People want to bring their own components into the framework.

**2. Submit to MCP directories on Day 1.**
Each directory (MCP.so, PulseMCP, Glama, Smithery) brought consistent traffic. Day 1 submissions means Day 1 traffic.

**3. Prepare a demo video.**
A 30-second clip showing the iteration loop (render → read → patch → preview) would communicate the workflow better than text.

**4. Start Discord engagement earlier.**
MCP and developer communities on Discord require genuine participation. Should have started weeks before launch.

## Impact on the MCP Ecosystem

This project demonstrates that MCP servers can be **multi-tool platforms**, not just single-tool adapters. The 4-tier pattern — structured creation, analysis, editing, and direct control — could apply to any domain where AI agents interact with files:

- Code generation (generate → review → refactor → format)
- Document creation (assemble → read → edit → export)
- Configuration management (template → validate → patch → apply)

## What's Next

- **Custom component API** — let users define their own components
- **Tailwind/Bootstrap output** — CSS framework support in templates
- **Multi-page projects** — scaffold entire site structures
- **Streamable HTTP transport** — for remote/cloud deployments

## Thank You

To everyone who starred the repo, opened issues, submitted PRs, and shared feedback — thank you. This project is open source, and the community response proved that this problem matters.

**[GitHub: Aimino-Tech/OpenTalk2HTML-NotMD](https://github.com/Aimino-Tech/OpenTalk2HTML-NotMD)**
**Usage:** `npx @aimino/opentalk2html-notmd`

The code is open. The architecture is public. I'm just getting started.
