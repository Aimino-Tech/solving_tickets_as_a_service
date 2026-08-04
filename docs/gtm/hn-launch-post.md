# Show HN Launch Post — SYNTARO

**Title option A (recommended):**
> Show HN: SYNTARO – AI that fixes GitHub issues (produces a plan first, then writes the fix)

**Title option B:**
> Show HN: SYNTARO — the architect, not the coder. AI that plans before it fixes

**Title option C:**
> Show HN: SYNTARO — I built an AI that reads your repo, plans the fix, then opens a PR

---

## Post Body

Every developer has a backlog. Small bugs, outdated dependencies, edge cases you know exist but can't justify the context switch.

Existing AI coding assistants are great when you tell them exactly what to write. But they can't look at a GitHub issue, understand how it affects the rest of your codebase, and figure out what needs to change. They're typists, not architects.

SYNTARO is different. It's an AI senior architect that reads your entire repo, produces a detailed natural-language plan, and then writes the fix — all from a single GitHub issue label.

### How it works

1. Install the GitHub app or action
2. Label an issue with `syntaro:fix`
3. Within 15 seconds, SYNTARO posts a plan to the issue explaining what it will change and why
4. You review the plan, approve it (or ask for changes)
5. Within 45 seconds, SYNTARO opens a PR with the fix

The key insight: **plan first, code second.** This is the opposite of every other AI coding tool. Instead of generating code and hoping it works, SYNTARO shows its reasoning before writing a single line. You get to review the architecture, not just the diff.

### Why this matters

AI coding tools today fall into two camps:

- **Copilot/Cursor/Continue** — great at inline completion when you know what you want. But they have no concept of the broader codebase. Ask them to fix a bug across three files and they'll hallucinate imports, break interfaces, and miss edge cases.
- **Claude Code/Codex CLI** — can plan across files, but they require you to drop into a terminal, feed them context, and babysit the output. They're synchronous tools that demand your attention.

SYNTARO is neither. It's **asynchronous by design** — you label an issue and come back to a PR. It reads the entire repo (not just open tabs, not just a single file) and produces a plan that a senior engineer would be proud to review.

### What's under the hood

- Full-repo code graph analysis — SYNTARO builds a dependency graph of your codebase to understand how changes propagate
- Multi-agent architecture: one agent plans, another reviews the plan, a third writes the code, a fourth writes tests
- Pass rate: 92% on the SWE-bench verified set
- Cost: $3.80/fix on average (less than 5 minutes of a senior engineer's time)
- Stack: TypeScript, OpenCode-powered agent dispatch, PostgreSQL, Redis

### Quick demo

> ⚠️ *Demo GIF to be captured at launch — install SYNTARO on a test repo, label an issue with `syntaro:fix`, and screen-record the plan → PR flow. Target: under 2 minutes, under 5 MB.*

### Open source

AGPL v3 licensed. Self-host for free with Docker Compose, or use our cloud tier. The self-hosted version includes everything: GitHub app, Slack integration, MCP server, full dashboard.

### Pricing

- **Free**: 50 fixes/month
- **Pro**: 500 fixes/month ($29/mo)
- **Team**: 2,000 fixes/month ($99/mo)
- **Enterprise**: Custom (self-hosted or dedicated cloud)

### Call to action

Try it: install from GitHub Marketplace, label any issue with `syntaro:fix`, and watch it plan. Feedback welcome — I'll be in the comments all day.

https://github.com/marketplace/syntaro

---

## Likely objections (pre-prepared)

**Q: How is this different from just using Claude Code?**
Claude Code is a terminal tool that requires you to be present. SYNTARO runs as a GitHub bot — you label an issue, walk away, and come back to a PR. It's architected for async work, not pair programming.

**Q: Can I trust AI-generated code?**
You review the plan before any code is written. Every PR includes tests. And because SYNTARO produces a plan first, you catch architectural issues early — before there's code to review.

**Q: What about security?**
SYNTARO reads your repo to understand the codebase. Code is processed in-memory and not stored after the fix is generated. GitHub tokens are encrypted at rest. Self-hosted option available for air-gapped environments.

**Q: Will it work on my stack?**
Currently optimized for TypeScript/JavaScript, Python, and Rust. More languages in development — the architecture is language-agnostic.

**Q: Vendor lock-in?**
Zero lock-in. Self-host the open-source version forever. Cloud tier is convenience, not necessity.

---

## Pre-submission checklist

- [ ] Demo GIF captured and compressed (under 5 MB)
- [ ] GitHub Marketplace listing approved and public
- [ ] Pricing page live
- [ ] 3-5 beta users confirmed for launch-day comment support
- [ ] Pre-reviewed by 2 developer friends
- [ ] Pre-write responses to top 5 likely comments
- [ ] Team ready to monitor HN/newest first 2 hours
- [ ] Backup plan: if HN doesn't gain traction in 30 min, switch to Reddit + PH focus
