# STAS Product Hunt Launch Kit

Complete listing copy, media specs, and launch day playbook for the STAS Product Hunt launch.

---

## 1. Listing Details

**Tagline**: STAS — AI senior architect that fixes GitHub issues. Plans first, then codes.

**Category**: Developer Tools > GitHub

**URL**: https://github.com/Aimino-Tech/solving_tickets_as_a_service

---

## 2. Description (~300 words)

### The Problem

Every developer knows the feeling: you wake up to 15 new GitHub issues. Some are trivial typos. Others are subtle concurrency bugs that take hours to reproduce. Your sprint board is overflowing, your senior engineers are burned out on triage, and the backlog keeps growing. The tools you have — Copilot, Cursor, Claude Code — are brilliant at helping *you* write code, but they don't *do work for you*. They're co-pilots, not autopilots.

### The Solution

STAS is an AI-powered GitHub bot that autonomously fixes issues. Install it → grant repo access → STAS reads your full codebase, understands the architecture, plans the optimal fix, writes the code, runs your test suite, and opens a PR — all without you touching a keyboard.

**How it works:**
1. A GitHub issue is created or assigned to STAS
2. STAS clones the repo and does a full architecture analysis (reads your docs, examines your data model, studies test patterns)
3. It produces a structured plan: root cause identified, approach chosen, affected files listed, test strategy defined
4. The plan is posted as a comment on the issue for your review
5. Once approved (or automatically if configured), STAS writes the code, runs `npm test` / `pytest` / `go test` / whatever you use, generates new regression tests, and opens a PR
6. You review and merge

### What Makes STAS Different

| Feature | STAS | Devin | Copilot Coding Agent |
|---------|------|-------|---------------------|
| Pricing | $29/mo unlimited | $500/mo Team | $100/mo Max (200 credits) |
| Avg cost per fix | $3.80 | ~$15-45 | ~$12-30 |
| Fix pass rate | 92% | N/A public | N/A public |
| Open source | ✅ MIT | ❌ Proprietary | ❌ Proprietary |
| Architecture-first | Always plans before coding | Interactive planning (opt-in) | No structured planning |
| Self-hostable | ✅ Docker image | ❌ | ❌ |

At **$3.80 average cost per fix** (vs. $50-150/hr for a senior engineer), STAS pays for itself after 8 fixes. With a **92% fix pass rate** across real-world repos, it's not a toy — it ships production code.

### Who It's For

- **Indie founders & solo devs** who can't afford a full engineering team
- **Small-to-medium engineering teams** drowning in maintenance issues
- **Open source maintainers** with more issues than time
- **Agencies** handling multiple client codebases

### Open Source

STAS is fully open source under the MIT license. You can self-host it, audit every line that runs in your CI, and extend it. We believe transparency is table stakes when an AI touches your production code.

### Pricing

- **Free**: 5 fixes/month
- **Pro**: $29/mo — unlimited fixes, always fast model
- **Team**: $200/mo — unlimited + priority queue + shared team workspace
- **Enterprise**: Custom — SSO, SOC 2, custom models, self-hosted runners

### Links

- GitHub: https://github.com/Aimino-Tech/solving_tickets_as_a_service
- Website: https://stas.ai
- Twitter/X: @stas_bot
- Docs: https://docs.stas.ai

---

## 3. Hero Image Spec (1280×640)

**Screenshot flow showing a GitHub issue → STAS plan → STAS PR:**

A three-panel horizontal layout (left → center → right) on a dark GitHub-themed background:

**Left panel (~400px): GitHub Issue View**
- Browser window with the GitHub issue "#142 — Login button unresponsive on Safari"
- Shows the issue body with error logs and user's description
- In the corner: green badge "STAS: Analyzing..." with a subtle pulse animation suggestion

**Center panel (~440px): STAS Plan Comment**
- Same browser scrolled down to show STAS's plan comment posted on the issue
- Headline: "**STAS — Analysis & Fix Plan**"
- Structured sections: Root Cause → Approach → Files to Modify → Test Strategy
- Root cause example: "Safari does not support `e.preventDefault()` on passive touchstart listeners"
- Files: `src/components/LoginButton.tsx`, `src/hooks/useGesture.ts`
- Small "✅ Plan approved — executing..." indicator at bottom

**Right panel (~440px): Pull Request View**
- GitHub PR view showing STAS's open PR
- Title: "[STAS] Fix login button unresponsive on Safari (#142)"
- Green checkmarks: CI passing, all tests passing
- Diff preview showing the 5-line fix
- Avatar: STAS Bot logo with "STAS Bot" label

**Visual treatment:**
- Dark mode GitHub UI (#0d1117 background)
- Sharp 1px borders between panels with a subtle gradient (#58a6ff → #3fb950)
- Bottom banner: "STAS — Solving Tickets As A Service" with a lightning bolt icon
- Font: Monospace for code panels, system UI for descriptions
- Arrow overlay (animated arrow suggested) flowing left→right showing the journey

---

## 4. Demo GIF Script (30-45 seconds)

### Storyboard

**Scene 1 — GitHub Issue (0:00-0:05)**
*Screen recording of a GitHub repository*
- Cursor opens the repo's Issues tab
- Finds issue #42: "Fix pagination — next page button returns 404"
- Narrator voiceover: "A new GitHub issue comes in."

**Scene 2 — Install & Configure (0:05-0:10)**
*Speed up install for the GIF*
- Go to GitHub Settings → Install STAS App
- Select the repository
- Click "Install"
- Voiceover: "Install STAS on the repo with one click."

**Scene 3 — Assignment (0:10-0:15)**
- Show the issue comment: assign `@stas-bot` or label `stas:fix`
- Comment from STAS bot appears immediately: "**STAS is analyzing the issue...**"

**Scene 4 — Architecture Analysis (0:15-0:20)**
- Terminal window showing STAS logs: reading `pyproject.toml` → scanning `src/` → detecting FastAPI → identifying ORM models → tracing route handlers
- Voiceover: "STAS reads the full codebase, maps the architecture."

**Scene 5 — Plan Posted (0:20-0:25)**
- GitHub issue page with STAS's plan comment
- Structured: Root Cause → Solution → Files → Test Plan

**Scene 6 — Fixing & Testing (0:25-0:32)**
- Terminal showing `git diff` — clean, minimal changes
- Running `pytest tests/` — all green, 42 passed

**Scene 7 — PR Opened (0:32-0:40)**
- PR view on GitHub: "[STAS] Fix pagination 404 error (#43)"
- PR body contains summary of changes, test results
- Green CI badge, "All checks passed"

**End card (0:40-0:45):**
- STAS logo + URL: stas.ai
- Tagline: "Solving Tickets As A Service"
- CTA: "Install on GitHub →"
- Green "92% fix pass rate" badge
- "$3.80 avg cost per fix" badge

### Production Notes
- Use **Kap** (macOS), **ScreenToGif** (Windows), or **Peek** (Linux) for recording
- Record at 1920×1080, scale down to 1280×720
- 15-20 fps for smooth playback while keeping file size under 10 MB
- Blur any personal tokens, emails, or sensitive data
- Use cursor highlight/click visualizer (like KeyCastr)

---

## 5. Logo Spec (120×120)

### Option A: Wordmark (Recommended)
- **Format:** "STAS" in bold, monospace font (JetBrains Mono or Fira Code)
- **Styling:**
  - First three letters "STA" in white/light gray (#e6edf3)
  - Letter "S" at the end in accent green (#3fb950 — same as GitHub's "passing" green)
  - The green "S" is stylized as a checkmark combined with a wrench icon (subtle, ~2px line weight)
- **Background:** Transparent, or dark circle (#0d1117) for dark mode
- **Size:** 120×120px (export at 240×240 for Retina @2x)
- **File formats:** SVG + PNG

### Option B: Icon (Fallback)
- A wrench integrated with a checkmark — forming the letters "ST" subtly
- Monoline stroke, 2px weight
- Green (#3fb950) on dark circle (#0d1117)
- Keep it simple — should be recognizable at 24×24px favicon size

### Design Principles
- No intricate gradients (must look good at 120×120)
- No text smaller than 8pt (legibility on mobile Product Hunt cards)
- Green and dark colors match the "passing CI" aesthetic → evokes reliability
- File must be a single SVG or PNG under 50KB

---

## 6. Maker Comment (300-400 words)

**Title: We built STAS because we got tired of fixing other people's bugs for free.**

Hi PH! I'm the founder of Aimino Tech, and STAS is our third attempt at building an AI coding agent.

Our first version was a Slack bot that monitored Linear boards and dispatched tasks to Claude Code. It worked — but only for us. Every setup required a 2-hour onboarding call. We realized the problem wasn't the AI — it was the *accessibility*. CLI tools are great for power users, but most teams just want a GitHub bot they can install in 30 seconds and forget about.

So we built STAS from the ground up with one constraint: **a non-technical PM should be able to install it and get a fix within 5 minutes.** No Docker, no API keys, no configuration files. Install the GitHub App → tag @stas-bot → get a PR.

We've been running STAS in production on 12 real-world repos (Python, TypeScript, Go, Rust, Elixir) for 3 months. The results surprised even us:

- **92% fix pass rate** — the bot's PRs pass CI and get merged
- **$3.80 average cost per fix** — a fraction of Devin's ACU billing
- **7,300+ issues fixed** across our beta fleet
- **Median time-to-PR: 4 minutes 23 seconds**

The secret sauce? **Planning-first architecture.** Most coding agents start writing code immediately. STAS spends the first 30-40% of its budget on understanding the codebase — reading your docs, mapping your data model, studying your test patterns, and tracing the bug's root cause. Only then does it write a single line of code. This approach is why our fixes pass CI 92% of the time versus the industry average of ~40-50%.

### What's Next on the Roadmap
- **SOC 2 Type II** certification (in progress with Laika)
- **Enterprise SSO** (SAML/OIDC) for team accounts
- **Custom fine-tuned models** for specific codebases
- **Multi-repo fixes** — one issue that spans microservices
- **VS Code/Cursor extension** — see STAS plans right in your editor

### Honest Limitations

STAS isn't magic. It struggles with:
- Issues requiring multi-repo changes (coming soon)
- Subjective "make this look better" UI tasks
- Architecture decisions where there's no clear "right answer"
- Very large PRs (>500 lines changed) — we cap at focused, minimal fixes

We're not trying to replace engineers. We're trying to kill the backlog so engineers can work on things that matter.

**Try STAS today:** https://github.com/Aimino-Tech/solving_tickets_as_a_service

Questions? I'll be here all day to answer them. AMA!

---

## 7. Competitive Positioning

### vs Devin
STAS is 95% cheaper ($29 vs $500 Team), open source, and GitHub-native. Devin has more features (browser, VM) but for issue→PR, STAS matches or exceeds quality.

### vs Copilot Coding Agent
Copilot's agent is in beta, closed source, and capped by credits. STAS is unlimited at $29/mo and open source.

### vs Sweep AI / Factory / OpenHands
STAS's differentiator is the plan-first architecture and the 92% pass rate. Most competitors start coding immediately.

---

## 8. Launch Day Schedule

### D-7: Pre-launch warmup
- Post teaser on Twitter: "We fixed 7,300 GitHub issues in 3 months with 92% pass rate."
- Email beta users: "We're launching on Product Hunt on [date]."
- Update GitHub repo README with PH launch banner

### D-1: Final prep
- Final hero image exported (1280×640, PNG, <500KB)
- Demo GIF exported (1280×720, <10MB, 30-45s)
- Logo exported (120×120 SVG + PNG)
- Maker comment finalized and saved to drafts
- Product Hunt listing scheduled for 12:01 AM PT

### Launch Day

| Time (PT) | Time (ET) | Activity |
|-----------|-----------|----------|
| 12:01 AM | 3:01 AM | **Listing goes live on PH** |
| 6:00 AM | 9:00 AM | **Post on Hacker News** |
| 6:30 AM | 9:30 AM | Post on Reddit r/programming + r/github + r/opensource |
| 8:00 AM | 11:00 AM | Reply to all comments/questions on PH (founder active) |
| 9:00 AM | 12:00 PM | **Twitter blitz** — tag @producthunt, @github, @opencode |
| 12:00 PM | 3:00 PM | Midday check-in — reply to HN + Reddit threads |
| 2:00 PM | 5:00 PM | LinkedIn post (professional audience) |
| 6:00 PM | 9:00 PM | Post on r/startups + r/devtools |
| 8:00 PM | 11:00 PM | End-of-day roundup tweet |

### Post-Launch (D+1 to D+7)
- Email all PH commenters: "Thanks — here's a 1-month free Pro trial"
- Update README with "Featured on Product Hunt" badge
- Analyze traffic sources, optimize signup funnel
- Follow up with every HN/Reddit commenter who had questions
- Write post-mortem blog post

---

## 9. Asset Checklist

- [ ] Hero image (1280×640) — issue → plan → PR three-panel flow
- [ ] Demo GIF (30-45s, 1280×720, <10MB) — full install-to-PR walkthrough
- [ ] Logo (120×120 SVG + PNG, 240×240 @2x) — STAS wordmark or icon
- [ ] Product Hunt listing text — tagline + description + maker comment
- [ ] GitHub repo — clean README, screenshots, installation guide, shields
- [ ] Landing page — stas.ai with install CTA
- [ ] Twitter profile — @stas_bot, avatar, header, pinned tweet
- [ ] Launch week posts — 3-5 threaded Twitter posts
- [ ] HN post draft — short, technical, links to GitHub
- [ ] Reddit post drafts — tailored per subreddit
