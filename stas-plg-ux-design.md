# STAS PLG UX Design — SaaS-Only Edition

> **Design philosophy**: STAS is a developer tool. Developers judge tools by *how fast they can ship something real*. Every screen, every click, every loading state must answer one question: *"Can I fix a ticket yet?"*

---

## 1. Self-Serve Onboarding: GitHub OAuth → One-Click Install → Zero Config

### Pattern Reference: Vercel's Git-First Signup + Linear's Bottom-Up Adoption

### 1.1 Landing → Signup (3 seconds)

```
┌─────────────────────────────────────────────────┐
│  STAS                                            │
│  Label a GitHub issue. Get a pull request.      │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  ▼ Continue with GitHub                     │ │
│  ├─────────────────────────────────────────────┤ │
│  │  ▼ Continue with GitLab                     │ │
│  ├─────────────────────────────────────────────┤ │
│  │  ▼ Continue with Bitbucket                  │ │
│  ├─────────────────────────────────────────────┤ │
│  │  or sign up with email                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  "Trusted by 500+ teams · No credit card required"│
└─────────────────────────────────────────────────┘
```

**Design decisions:**
- **GitHub OAuth as primary CTA** — largest button, anchored on left. Developer already authenticated → zero password friction.
- **No email-first** — email is in the overflow, not the default. Vercel's insight: OAuth pre-fills the rest of the funnel.
- **Scope requested on signup** — read-only repo access + webhook management. No code write access yet (asked at first fix).

### 1.2 Post-OAuth: "Install STAS on Your Repos" (1 click)

After GitHub OAuth, the user lands here:

```
┌────────────────────────────────────────────────────────┐
│  Install STAS on your repositories                     │
│                                                         │
│  Pick repos STAS will watch for "stas:fix" labels:      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  ☑  All repositories                              │  │
│  │  ☐  Only selected repositories                    │  │
│  │                                                    │  │
│  │  ┌─ Selected repositories ──────────────────────┐ │  │
│  │  │  ☑ my-org/api-service                        │  │  │
│  │  │  ☑ my-org/frontend-app                       │  │  │
│  │  │  ☐ my-org/internal-tools                     │  │  │
│  │  │                                               │  │  │
│  │  └──────────────────────────────────────────────┘ │  │
│  │                                                    │  │
│  │  [Install STAS GitHub App]                         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  › No configuration needed. STAS works with stas:fix    │
│    label out of the box.                                │
└────────────────────────────────────────────────────────┘
```

**Design decisions:**
- **Single screen replaces the typical "create account → verify email → configure → docs → deploy" pipeline** — Vercel's insight: compress every step you can.
- **"All repositories" is the default** — reduces cognitive load. Users who want selective install can opt down.
- **The GitHub App installation is triggered FROM inside the STAS UI** (not redirected to GitHub settings). We use the GitHub API to pre-authorize the installation — user just clicks "Install" and we handle the redirect in a silent popup.

### 1.3 Zero-Config Dashboard (immediately after install)

```
┌────────────────────────────────────────────────────────┐
│  STAS  ● Dashboard  ▼ user/org                         │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │  ✅ STAS is installed on 2 repositories.        │    │
│  │                                                  │    │
│  │  Your first fix is 1 label away:                 │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐   │    │
│  │  │  1. Open any issue in your repo           │   │    │
│  │  │  2. Add label → stas:fix                  │   │    │
│  │  │  3. STAS does the rest → PR appears       │   │    │
│  │  └──────────────────────────────────────────┘   │    │
│  │                                                  │    │
│  │  [Open a repo to try it →]                       │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─── Connected Repos ─────────────────────────────┐   │
│  │  ● my-org/api-service     🟢 Active   View issues│   │
│  │  ● my-org/frontend-app    🟢 Active   View issues│   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
└────────────────────────────────────────────────────────┘
```

**Design decisions:**
- **Empty state is not empty** — it shows the shortest path to first value. No welcome popup, no tutorial, no checklist.
- **"Open a repo to try it →"** is a link that opens GitHub in a new tab with a pre-populated issue URL.
- **Repos list is immediately populated** — no "add your first repo" form. They're already connected.

---

## 2. Shortest Path to First PR: Label → Fix → PR in 3 Clicks

### Pattern Reference: Vercel's Deploy Button (6 steps → 1 click)

### The 3-Click Flow

```
Click 1: Open any GitHub issue → add label "stas:fix"
Click 2: (optional) Confirm on STAS dashboard (or just wait)
Click 3: Review the draft PR that STAS opens

Total: ~90 seconds from label to PR
```

### Detailed Flow

#### Step 1: Label the Issue (GitHub.com)

User is on a GitHub issue they want fixed:

```
┌─────────────────────────────────────────────────┐
│  Labels ▾                                        │
│  ┌───────────────────────────────────────────┐  │
│  │  ✕ bug                                    │  │
│  │  ✕ enhancement                            │  │
│  │  + stas:fix  ← type to search             │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ✓ STAS will pick this up automatically          │
└─────────────────────────────────────────────────┘
```

**Visual feedback**: When `stas:fix` is applied, a small toast/confetti appears:
> "🔄 STAS is investigating this issue. Estimated PR in 2-4 minutes."

#### Step 2: Real-time Progress (dashboard OR issue comments)

**On GitHub (default — no dashboard visit needed):**

```
┌─────────────────────────────────────────────────┐
│  stas-bot commented 30 seconds ago               │
│                                                   │
│  🔍 Investigating root cause...                   │
│  📦 Cloning repository                             │
│  🔧 Writing fix...                                 │
│  ✅ Running test suite (3/3 passed)                │
│  🚀 Opening pull request...                        │
│                                                   │
│  ───                                              │
│  View live progress → [STAS Dashboard]             │
└─────────────────────────────────────────────────┘
```

**Design decisions:**
- **Real-time status as issue comments** — user stays on GitHub, no context switch.
- **Progress emojis** create visual delight and communicate agent activity.
- **Dashboard link is secondary** — the primary experience is on GitHub.

#### Step 3: Draft PR Appears (GitHub.com)

```
┌──────────────────────────────────────────────────────┐
│  [Draft] Fix #87: Handle null pointer in user auth    │  ◀ New PR
├──────────────────────────────────────────────────────┤
│  stas-bot wants to merge 2 commits into main from    │
│  stas/fix-87-null-pointer                             │
│                                                       │
│  ## Root Cause                                        │
│  User.login() doesn't validate session before access  │
│                                                       │
│  ## Changes                                           │
│  - Add null check in login.ts:45                      │
│  - Add regression test for null session               │
│                                                       │
│  ## Verification                                      │
│  - ✅ Existing tests pass (24/24)                     │
│  - ✅ New regression test added                       │
│  - ✅ Sandbox isolated execution                      │
│                                                       │
│  ───                                                  │
│  🛠 Fixed by [STAS](https://stas.dev) — AI-powered    │
│  issue resolution. [Dashboard](https://stas.dev/runs) │
│                                                       │
│  [Review] [Merge] [Close]                             │
└──────────────────────────────────────────────────────┘
```

**Design decisions:**
- **Draft PR** — user must explicitly set it to "Ready for Review" (safe default).
- **"Fixed by STAS" footer** — core viral loop element (see section 3).
- **PR template explains root cause, changes, verification** — builds trust in AI output.

---

## 3. Viral Loop Design

### Pattern Reference: Vercel Deploy Button + Slack Team Invites

### 3.1 PR Footer: "Fixed by STAS"

Every PR created by STAS includes:

```
---

🛠 Fixed by [STAS](https://stas.dev/from/pr-87?ref=github-pr-footer) — 
the AI-powered issue resolution platform.

[Get STAS for your team →](https://stas.dev?ref=github-pr-footer)
```

**Why this works:**
- **PR comments are public** (in public repos) — visible to every developer who views the PR.
- **Social proof** — seeing an AI fix a real issue in a real repo is the strongest demo.
- **UTM tracking** — `ref=github-pr-footer` lets us measure exactly how many signups come from PR footers.

### 3.2 "Try it on your repo" Onboarding PR

When a user installs STAS but hasn't run a fix yet, STAS opens a **demo pull request** in their repo:

```
┌──────────────────────────────────────────────────────┐
│  [Demo] Welcome to STAS — here's how it works        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Hi! I'm STAS, the AI issue resolver.                 │
│                                                       │
│  **Try me:**                                          │
│  1. Open any issue in this repo                       │
│  2. Add the `stas:fix` label                          │
│  3. I'll investigate, write a fix, and open a PR      │
│                                                       │
│  No config needed. No API keys. Just a label.         │
│                                                       │
│  → Close this PR and label an issue to get started    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

**Why this works:**
- **Demonstrates the product inside the user's own context** — not a sandbox or tutorial.
- **The demo PR itself is a PR** — dogfooding the product format.
- **Zero friction** — user doesn't need to create a test issue; the demo PR shows them exactly what to do.

### 3.3 Shareable Run Dashboard

Each completed fix has a dedicated shareable URL:

```
https://stas.dev/runs/run_abc123
```

The page shows:
- **Root cause analysis** (truncated, with full view for logged-in users)
- **Diff preview** (full for paid, partial for free/anon)
- **"See how this was fixed"** share button → copies link to clipboard
- **Reusable embed** — `<iframe>` or markdown badge for blog posts

**Viral mechanics:**
- Developer tweets: "STAS just fixed a bug in our auth system → [link]"
- Others click → see a real fix → sign up to try it on their own repo
- **Embeddable badge** for README: `[Fixed by STAS](https://stas.dev/runs/run_abc123)`

### 3.4 Team Viral Loop (Slack-inspired)

```
Individual discovers STAS
        │
        ▼
Signs up, fixes an issue
        │
        ▼
PR footer visible to team
        │
        ▼
Team member clicks "Get STAS for your team"
        │
        ▼
Joins the same workspace (or creates new one)
        │
        ▼
Team hits free tier limit together
        │
        ▼
Org purchases paid plan
```

**Implementation:**
- **Workspace-based** — when user signs up via GitHub Org, STAS creates a workspace for that org.
- **Team invite** — dashboard shows "Invite your team →" with a shareable link.
- **Shared usage** — all team members' fixes count toward the workspace's monthly limit.

---

## 4. Free → Paid Conversion Triggers

### Pattern Reference: Slack's Message History Limit (timing is everything)

### 4.1 The Free Tier

| Feature | Free | Pro ($49/mo) | Enterprise |
|---|---|---|---|
| Fixes per month | 3 | 100 | Custom |
| Repos | Up to 3 | Unlimited | Unlimited |
| Team members | 1 | Up to 10 | Unlimited |
| Root cause analysis | ✅ | ✅ | ✅ |
| Regression tests | ✅ | ✅ | ✅ |
| Agent model | Shared AGI* | Dedicated AGI | Private AGI instance |
| Priority queue | ❌ | ✅ | ✅ |
| Audit log | 7 days | 90 days | Unlimited |
| SSO/SAML | ❌ | ❌ | ✅ |
| Support | Community | Slack + Email | Dedicated Slack + Phone |

*\*Free tier users get pooled AGI with best-effort latency.*

### 4.2 Conversion Trigger #1: "You've used 2 of 3 fixes" (value-established)

Triggered after the **second** fix completes, not on signup.

```
┌──────────────────────────────────────────────────────┐
│  You've used 2 of your 3 free fixes this month.       │
│                                                        │
│  Here's what you'd get with Pro ($49/mo):              │
│  • 100 fixes/month (33x more)                          │
│  • Priority queue (no waiting)                         │
│  • Unlimited repos and team members                    │
│                                                        │
│  [See Pro Features] [No thanks, I'll use my last fix]  │
└──────────────────────────────────────────────────────┘
```

**Why this works (Slack pattern):**
- **Triggered AFTER value is established** — user has already seen STAS fix 2 issues.
- **Not a popup on day 1** — that would feel salesy before they understand the product.
- **Timing**: the message appears when they're about to run out — the moment of maximum perceived value.

### 4.3 Conversion Trigger #2: Post-Fix "Unlock Full Analysis"

After the 3rd (last) free fix, the full PR analysis is partially blurred:

```
┌──────────────────────────────────────────────────────┐
│  Root Cause Analysis                                  │
│                                                        │
│  The null pointer occurs in login.ts:45 when...       │
│  (full analysis continues)                             │
│                                                        │
│  ┌─ Unlock deeper insights ───────────────────────┐  │
│  │                                                 │  │
│  │  🔒 Suggested fix alternatives (visible on Pro) │  │
│  │  🔒 Security impact assessment                  │  │
│  │  🔒 Performance regression analysis             │  │
│  │                                                 │  │
│  │  [Upgrade to Pro - $49/mo →]                    │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Design decisions:**
- **The fix itself is never blocked** — user always gets the PR. We never break the core loop.
- **The gate is on *supplementary value* — deeper analysis that Pro users get.
- **"Try Pro free for 7 days"** — one-click trial, no credit card (converts power users).

### 4.4 Conversion Trigger #3: Team Member Invite → Workspace Upgrade

When a free user invites a team member:

```
┌──────────────────────────────────────────────────────┐
│  You've invited @teammate to your workspace.          │
│                                                        │
│  With STAS Free, only you can create fixes.            │
│  Upgrade to Pro to let your whole team use STAS:      │
│                                                        │
│  • @teammate can also label issues for STAS to fix    │
│  • Shared fix history and audit log                   │
│  • Combined monthly limit (100 fixes/team)             │
│                                                        │
│  [Upgrade to Pro - $49/mo] [Continue with Free]       │
└──────────────────────────────────────────────────────┘
```

**Why this works (Slack pattern):**
- The **social pressure** of having a teammate who can't use the tool drives conversion.
- The value of collaboration exceeds the $49/mo threshold for most teams.

### 4.5 Conversion Trigger #4: Usage Velocity Notification

If a user uses all 3 free fixes in under 24 hours:

```
┌──────────────────────────────────────────────────────┐
│  You've used 3 fixes today — you're on a roll!        │
│                                                        │
│  Looks like STAS is fitting into your workflow.        │
│                                                         │
│  Pro gives you 100 fixes/month so you never have to    │
│  stop and wait.                                        │
│                                                         │
│  [Upgrade to Pro - $49/mo] [Wait for next month]       │
└──────────────────────────────────────────────────────┘
```

**Why this works:**
- **High-velocity usage is the strongest buying signal** — the user has clearly found value.
- The notification frames upgrading as "removing a blocker" not "paying for features."

---

## 5. The "Aha Moment" UX Flow

### Pattern Reference: Linear's sub-50ms response times + Vercel's deploy celebration

### 5.1 The Aha Moment Defined

**The STAS aha moment**: *A bug you expected to spend 30+ minutes debugging is fixed in under 5 minutes with a correct, well-tested PR.*

### 5.2 End-to-End Aha Flow

```
Time    Event                           User Emotion
────    ─────                           ───────────
T+0s    Labels issue "stas:fix"         👆 Hopeful
T+10s   Bot comments "Investigating"   😮 Intrigued
T+60s   Bot comments "Found root cause" 🤔 Impressed
T+120s  Bot comments "Fix written +    😲 Amazed
        tests passing"
T+150s  Draft PR appears               🎯 Aha! → "That just worked."
T+180s  User reviews PR — it's correct ✅ Trust built
T+190s  User clicks "Ready for Review" 🚀 Converted
```

### 5.3 Emotional Design Elements

**a) The "Wow, that was fast" moment (T+10s → T+120s)**
- Real-time progress emojis create a sense of speed and transparency.
- Each step is a mini-celebration (not just a loading spinner).

**b) The "It actually works" moment (T+150s)**
- The PR appears with a subtle animation (slide-in or fade-in on dashboard, or a smooth appear on GitHub).
- The PR body is structured like a human engineer wrote it (root cause, changes, verification) — not a machine dump.

**c) The "I trust this" moment (T+180s)**
- Tests passing is called out prominently.
- The diff is clean and focused (no unrelated changes).
- A "confidence score" displays: "95% confidence — root cause confirmed by 2 of 3 analysis paths."

### 5.4 Post-Aha: Next Steps (no checklist, just suggestions)

After the first successful fix, the dashboard shows a **single next action**, not a list:

```
┌──────────────────────────────────────────────────────┐
│  ✅ First fix complete!                                │
│                                                        │
│  Want to see what else STAS can do?                    │
│                                                        │
│  → Fix another issue (label with stas:fix)             │
│  → Invite your team to collaborate                     │
│  → [View run history]                                  │
└──────────────────────────────────────────────────────┘
```

**Design decisions (Vercel pattern):**
- Only one primary CTA: "Fix another issue." The secondary actions are understated.
- No "Welcome! Here are 7 things to do" modal. Trust the user to explore.

---

## 6. Pricing Page UX

### Pattern Reference: Linear's transparent pricing + Slack's fair billing

```
┌──────────────────────────────────────────────────────────┐
│  Simple pricing. No hidden fees.                          │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │  Free         │  │  Pro         │  │  Enterprise     │ │
│  │               │  │  $49/mo      │  │  Custom         │ │
│  │               │  │              │  │                 │ │
│  │  3 fixes/mo   │  │  100 fixes/mo│  │  Unlimited      │ │
│  │  3 repos      │  │  Unlimited   │  │  Everything in │ │
│  │  1 user       │  │  10 users    │  │  Pro + SSO,    │ │
│  │  Best-effort  │  │  Priority    │  │  SLA, dedicated│ │
│  │  AGI          │  │  AGI         │  │  AGI instance  │ │
│  │               │  │  90-day audit│  │                 │ │
│  │               │  │  Slack support│  │                 │ │
│  │               │  │              │  │                 │ │
│  │  [Get Started] │  │  [Start Free │  │  [Contact Us]  │ │
│  │               │  │   Trial]     │  │                 │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│                                                           │
│  ───                                                        │
│  All plans include: Our AGI (50% better than GPT-5.5),     │
│  automated regression tests, sandbox-isolated execution.    │
│                                                           │
│  Fair billing: Only charged for active months. Pause       │
│  anytime. No long-term contracts.                          │
└──────────────────────────────────────────────────────────┘
```

**Design decisions:**
- **"Start Free Trial" on Pro** — not "Buy Now." Users want to try before buying.
- **Free plan prominently visible** — not hidden. Slack's lesson: free tier drives adoption.
- **"Fair billing"** — Slack's terminology, builds trust.

---

## 7. Implementation Recommendations

### Priority Order (build in this order)

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | GitHub OAuth + GitHub App install flow | 2-3 days | Unlocks all onboarding |
| P0 | `stas:fix` label → PR pipeline (already built) | Done | Core loop |
| P1 | PR footer "Fixed by STAS" + UTM tracking | 0.5 day | Viral distribution |
| P1 | Free tier limit (3 fixes/month) | 1 day | Conversion trigger foundation |
| P1 | In-app conversion messaging (2-of-3 trigger) | 1 day | Free→paid conversion |
| P2 | Shareable run dashboard (public URL per fix) | 2 days | Viral content |
| P2 | Team invites + workspace model | 3 days | Viral loop |
| P3 | Demo onboarding PR | 1 day | New user activation |
| P3 | Post-fix "confidence score" display | 1 day | Trust building |
| P3 | 7-day free trial on Pro | 2 days | Conversion lift |

### Key UX Metrics to Track

| Metric | Target | Why |
|--------|--------|-----|
| Time from signup to first label | < 2 min | Onboarding effectiveness |
| Time from label to PR | < 5 min | Core product quality |
| % of users who use 2nd fix | > 60% | Stickiness |
| % of users who exhaust 3 fixes | > 30% | Value proved |
| % of exhausted users who upgrade | > 15% | Conversion effectiveness |
| Viral coefficient (invites per user) | > 0.5 | Viral loop health |

---

## 8. Visual Mockup Summary

### Page Inventory

| Page | URL | Purpose |
|------|-----|---------|
| Landing | `stas.dev` | Value prop + GitHub OAuth |
| Dashboard | `stas.dev/dashboard` | Repos list, quick stats, next action |
| Run Detail | `stas.dev/runs/:id` | Fix analysis, diff, share |
| Run History | `stas.dev/runs` | All fixes, search, filters |
| Settings | `stas.dev/settings` | Repos, team, billing |
| Pricing | `stas.dev/pricing` | Plans, comparison |
| Upgrade | `stas.dev/upgrade` | Stripe checkout |

### Key UX Principles

1. **Never break the GitHub flow** — the user's primary workspace is GitHub. STAS augments it, replaces nothing.
2. **Zero-config is a feature** — every dropdown, form field, and setting you remove is a conversion you gain.
3. **Limit after value** — don't show the paywall until the user has felt the product's value (Slack's key insight).
4. **The PR is the product** — every PR STAS creates is a marketing asset. Make it beautiful, thorough, and shareable.
5. **Speed is the brand** — STAS's brand promise is "fixes faster than a human." Every UX element must communicate speed: loading states are progress animations, not spinners.
