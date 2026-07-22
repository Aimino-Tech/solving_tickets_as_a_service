# STAS — GitHub Marketplace Listing

> Ready-to-submit listing copy for the STAS GitHub App on [GitHub Marketplace](https://github.com/marketplace).

---

## App Name

**STAS — Solving Tickets As A Service**

---

## Short Description

*Maximum 180 characters — shown in search results and card views.*

> AI senior architect for GitHub issues. Reads your repo, plans the fix, and opens a PR — in under 60 seconds. Just label an issue with `stas:fix`.

**Character count:** 158/180 ✓

---

## Full Description

*Maximum 1,000 characters — main listing body.*

STAS is an AI senior architect that reads your entire codebase, plans the fix, and opens a pull request — all from a single label. No IDE required. No context switching. Just label an issue and come back to a PR.

### How It Works

1. **Label any issue** with `stas:fix` — no special syntax, no commands to remember
2. **STAS reads your full repo** — not just one file, not just the diff — the entire codebase
3. **You get a detailed plan** — root cause analysis and fix approach, posted as an issue comment
4. **After approval, STAS writes the fix** — runs your tests, opens a draft PR with passing checks

### Key Features

- **Plan-first architecture** — see what STAS plans to do before it writes any code. Review the approach, approve or request changes, then watch it execute
- **Full-repo context** — STAS doesn't just look at lines around the bug. It understands your entire codebase, including tests, configs, and dependencies
- **Async workflow** — label an issue now, come back to a PR. Works while you sleep. No pairing, no screen sharing, no context switching
- **Complementary to your tools** — use alongside Copilot, Cursor, or Claude Code. STAS is the architect that plans and reviews; they're the coders that implement
- **Open core** — AGPL v3 licensed. Self-host on your own infrastructure or use the cloud version. No vendor lock-in
- **MCP-enabled** — connect STAS to any MCP-compatible agent (Claude Desktop, Cursor, Codex CLI, OpenCode) for zero-config setup

### Who It's For

Solo developers, small teams, and organizations tired of backlog bugs. Free tier available for public repos. Pro plan for private repos and priority support.

### Get Started

[Install STAS →](https://github.com/marketplace/actions/stas-eval)

Label an issue with `stas:fix` and watch your backlog shrink.

---

## Category

**Code review / Automated fixes**

> GitHub Marketplace categories: "Code review", "Automated fixes", "Bots", "Developer tools". "Code review / Automated fixes" is the closest match and where STAS will appear in search.

---

## Pricing Plan

| Tier | Price | Fixes/mo | Private Repos | Queue | MCP/API |
|------|-------|----------|---------------|-------|---------|
| **Free** | $0 | 50 | ❌ | Standard | ❌ |
| **Pro** | $19/mo | 500 | ✅ | Priority | ✅ |
| **Team** | $49/mo | 2,000 | ✅ | Priority | ✅ |

All tiers include: full-repo context, plan-first workflow, test execution, draft PR creation, and community support.

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

(These are handled in AIM-3391 — coordinate with that ticket's owner.)

---

## Submission Checklist

- [ ] App name and short description written (≤180 chars)
- [ ] Full description written and reviewed (≤1,000 chars)
- [ ] Category selected: "Code review / Automated fixes"
- [ ] Logo prepared (120×120 PNG)
- [ ] Screenshot(s) prepared (1280×640 PNG, ≤2MB)
- [ ] Demo GIF recorded (optional, 30-45s, ≤10MB)
- [ ] Pricing plan configured in GitHub Marketplace billing UI
- [ ] Privacy policy URL configured
- [ ] Terms of service URL configured
- [ ] Verified Publisher badge obtained (see [GitHub docs](https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/applying-for-publisher-verification-for-your-organization))
- [ ] App public page reviewed at `https://github.com/marketplace` after publishing
