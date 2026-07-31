# STAS — GitHub Marketplace Listing

> Ready-to-submit listing copy for the STAS GitHub App on [GitHub Marketplace](https://github.com/marketplace).

---

## App Name

**STAS — Solving Tickets As A Service**

---

## Short Description

*Maximum 180 characters — shown in search results and card views.*

> Automated AI bug fix bot for GitHub issues. Reads your repo, plans the root cause analysis, and opens a pull request — all from a single `stas:fix` label.

**Character count:** 162/180 ✓

> *Optimized for search keywords: "AI code fix", "automated PR", "bug fix bot", "pull request", "code review"*

---

## Full Description

*Maximum 1,000 characters — main listing body.*
*Current count: ~990 characters.*

STAS is an automated AI bug fix bot that reads your entire codebase, plans the root cause analysis, and opens a pull request — all from a single `stas:fix` label. No IDE required. No context switching. Just label an issue and come back to a PR with passing tests.

### How It Works

1. **Label any issue** with `stas:fix` — no special syntax, no commands to remember
2. **STAS reads your full repo** — not just one file, not just the diff — the entire codebase including configs, tests, and dependencies
3. **You get a detailed plan** — root cause analysis and fix approach, posted as an issue comment
4. **After approval, STAS writes the fix** — runs your tests, opens a draft PR with passing checks

### Why STAS

- **92% fix pass rate** on XOR benchmark — 2x the industry average
- **97M+ MCP monthly SDK downloads** — proven ecosystem
- **Flat-rate pricing** — no per-seat fees like CodeRabbit. Pay for fixes, not users

### Try It First

Visit the [STAS Demo Repository](https://github.com/Aimino-Tech/stas-demo) — a public app with 15+ seeded bugs. Label any issue with `stas:fix` and see STAS create a PR in minutes. No installation required.

### Key Features

- **Plan-first architecture** — see what STAS plans to do before it writes any code. Review the approach, approve or request changes, then watch it execute
- **Full-repo context** — STAS doesn't just look at lines around the bug. It understands your entire codebase, including tests, configs, and dependencies
- **Async workflow** — label an issue now, come back to a PR. Works while you sleep. No pairing, no screen sharing, no context switching
- **Open core** — AGPL v3 licensed. Self-host on your own infrastructure or use the cloud version. No vendor lock-in
- **MCP-enabled** — connect STAS to any MCP-compatible agent (Claude Desktop, Cursor, Codex CLI, OpenCode) for zero-config setup
- **AI trust first** — every PR passes 6 quality gates before review: reality, compile, test integrity, hallucination scan, dead code check, and MCI verification

### Pricing

| Tier | Price | Fixes/mo | Private Repos | Best For |
|------|-------|----------|---------------|----------|
| **Free (OSS)** | $0 | Unlimited on public repos | ❌ | Open source projects |
| **Solo** | $49/mo | 2,000 | ✅ Up to 5 | Individual developers |
| **Team** | $149/mo | 10,000 | ✅ Unlimited | Small teams |
| **Enterprise** | Custom | Unlimited | ✅ Unlimited | Organizations |

> 🎯 **Free for OSS** — unlimited fixes on public repositories. No credit card required.

### Security & Compliance

- **SOC 2 compliant** — enterprise-grade security controls
- **GDPR compliant** — data processed in EU (Hetzner) with DPA available
- **Minimal OAuth scopes** — Contents:write, Issues:read, Metadata:read only
- **Encryption at rest** (AES-256) and **in transit** (TLS 1.3)

### Who It's For

Solo developers, small teams, and organizations tired of backlog bugs. Free tier available for public repos. Paid plans for private repos and priority support.

### Get Started

[Install STAS on GitHub Marketplace →](https://github.com/marketplace/actions/stas-eval)

Label an issue with `stas:fix` and watch your backlog shrink.

---



## Search Keyword Strategy

Keywords to ensure appear in listing copy for maximum Marketplace discoverability:

| Volume | Keywords |
|--------|----------|
| **High-volume** | AI code review, automated PR, bug fix, issue tracker, code quality |
| **Medium-volume** | automated fix, pull request bot, github bot, AI code fix |
| **Long-tail** | automated issue resolution, AI PR creator, automated bug fixing |

---

## Category

**Code review / Automated fixes**

> GitHub Marketplace categories: "Code review", "Automated fixes", "Bots", "Developer tools". "Code review / Automated fixes" matches both and is where STAS will appear in search.
>
> **Target tags:** ai-assisted, code-review, automated-fixes, bots, developer-tools, pull-requests

---

## MCP Usage Tracking

PostHog events added to MCP agent server for tracking agent discovery and tool usage:

| Event | Trigger | Properties |
|-------|---------|------------|
| `mcp_tool_invoked` | Any MCP tool call | tool name, parameters |
| `mcp_tool_discovered` | tools/list request | available tools count |

Tracked in `src/mcp/agentServer.ts` via existing `captureEvent` from `src/analytics/tracker.ts`.

---

## Visual Assets Preparation Guide

### Logo (120×120 PNG)

**What to create:**
- STAS wordmark or icon mark
- Clean, recognizable at small size
- High contrast for both dark and light Marketplace themes
- Format: PNG, transparent background preferred

**Design specs:**
- 120×120 pixels (GitHub requires exact 1:1 aspect)
- Max file size: 1MB
- Use the STAS brand colors (see `docs/brand-guide.md` or `public/github-app-manifest.json`)

### Listing Screenshot (1280×640 PNG)

Three options — pick one or all:

**Option 1: Plan Output (Recommended)**
*Captures the plan-first differentiator.*

- Navigate to a GitHub issue where STAS has posted a plan comment
- Capture the full issue view showing:
  - Issue title and description at top
  - STAS's plan comment below with "Root Cause Analysis" and "Fix Approach" sections
  - Resolution: 1280×640
  - Annotate with a subtle highlight box around the plan comment

**Option 2: Dashboard (Cloud Users)**
*Shows fix history and metrics.*

- Navigate to the STAS dashboard at `https://stas.aimino.io`
- Capture the main analytics view showing:
  - Fix success rate
  - Recent fix history
  - Average fix time
  - Resolution: 1280×640

**Option 3: Split View (Issue + PR)**
*Shows the full workflow in one image.*

- Left half: Issue view with the `stas:fix` label visible
- Right half: The resulting PR with passing checks
- Resolution: 1280×640
- Add a curved arrow or "60 seconds later" transition element

**Technical requirements:**
- Format: PNG
- Max file size: 2MB
- No text smaller than 14px (must be readable at thumbnail size)
- STAS branding visible in the image
- No sensitive data shown (use a demo repo)

### Demo GIF (Optional — Highly Recommended)

**Storyboard (30-45 second walkthrough):**

| Time | Scene | Description |
|------|-------|-------------|
| 0:00–0:03 | **Intro** | Browser tab titled "GitHub — stas-demo/issues" with an open issue. Issue has label `stas:fix` |
| 0:03–0:08 | **Label applied** | User clicks "Labels" → selects `stas:fix` → label appears on issue |
| 0:08–0:10 | **Transition** | Fade to black or flash effect showing "STAS is working..." |
| 0:10–0:22 | **Plan appears** | Issue auto-refreshes showing STAS's plan comment: "Root Cause Analysis" + "Fix Approach" |
| 0:22–0:25 | **Approval** | User comments `/stas approve` or the plan shows auto-approval timer |
| 0:25–0:35 | **PR created** | Cut to the PR view: STAS has created a draft PR with code changes and passing check runs |
| 0:35–0:42 | **Outro** | Zoom out to dashboard showing fix history. Overlay text: "STAS — Label. Fix. Ship." and URL |

**Technical requirements:**
- Duration: 30–45 seconds
- Max file size: 10MB
- Resolution: 1280×720 or 1920×1080
- Frame rate: 15–24 fps
- Codec: H.264 (widest compatibility)
- No audio
- Clean UI: use a demo repo (`stas-demo` or similar) with sanitized data

**Recording tools:**
- [Kap](https://getkap.co/) (macOS, free, lightweight)
- [Screen Studio](https://www.screen.studio/) (macOS, paid, professional)
- [OBS Studio](https://obsproject.com/) (cross-platform, free, advanced)
- [CleanShot X](https://cleanshot.com/) (macOS, paid, easy)

---

## Privacy Policy & Terms of Service

Before submitting to Marketplace, ensure the following URLs are live and linked in the GitHub App settings:

- **Privacy policy URL:** `https://stas.aimino.io/privacy`
- **Terms of service URL:** `https://stas.aimino.io/terms`

> ✅ Privacy policy and ToS pages are now created at `website/privacy.html` and `website/terms.html`.
> ⚠️ **Not yet live** — the website has never deployed (`stas.aimino.io` currently returns NXDOMAIN, the `FLY_API_TOKEN` repo secret is missing, and GitHub org billing blocks Actions). Follow [docs/marketplace/submission-runbook.md](docs/marketplace/submission-runbook.md) **Phase A** to unblock, then verify with `bash scripts/check-marketplace-live.sh`.

---

## Submission Checklist

> Execution order and owners for the open items: [docs/marketplace/submission-runbook.md](docs/marketplace/submission-runbook.md).

- [x] App name and short description written (≤180 chars)
- [x] Full description written and reviewed (≤1,000 chars)
- [x] Category selected: "Code review / Automated fixes"
- [ ] Logo prepared (120×120 PNG)
- [ ] Screenshot(s) prepared (1280×640 PNG, ≤2MB)
- [ ] Demo GIF recorded (optional, 30-45s, ≤10MB)
- [ ] Pricing plan configured in GitHub Marketplace billing UI
- [ ] Privacy policy URL live at `https://stas.aimino.io/privacy` (see runbook Phase A, verify with `scripts/check-marketplace-live.sh`)
- [ ] Terms of service URL live at `https://stas.aimino.io/terms` (see runbook Phase A, verify with `scripts/check-marketplace-live.sh`)
- [ ] Verified Publisher badge obtained (see [GitHub docs](https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/applying-for-publisher-verification-for-your-organization)) and [verified-publisher-guide.md](docs/marketplace/verified-publisher-guide.md)
- [ ] App public page reviewed at `https://github.com/marketplace` after publishing
