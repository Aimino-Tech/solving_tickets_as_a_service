# STAS Newsletter Outreach Plan

> Launch date: TBD | Outreach starts: T-3 weeks
> Prepared for STAS (Solving Tickets As A Service) by AImino

---

## Overview

Newsletter mentions provide compounding organic reach. A single mention in a high-readership
newsletter drives 1-5K visits over 48 hours with 3-5x higher CTR than social media for
developer products. Unlike social media, newsletter traffic has longer shelf life and higher
conversion rates.

**Goal:** Secure mentions in 5+ Tier 1-2 newsletters before launch day.
**Strategy:** Build relationships 2-4 weeks before launch (most newsletters book content in advance).

---

## Tier 1: Mega Newsletters (100K+ subscribers)

High effort, high impact. Pitch requires personalized outreach and compelling story.

| # | Newsletter | Subscribers | Pitch Angle | Contact | Notes |
|---|-----------|-------------|-------------|---------|-------|
| 1 | **TLDR AI** | 500K+ | New open-source AI dev tool that fixes GitHub issues automatically | sponsors@tldr.tech | Most cost-effective per-visit. Accepts sponsorships ($750-2K). Also pitch guest post. |
| 2 | **The Batch (Andrew Ng)** | 800K+ | AI that plans before it codes — architectural approach | thebatch@deeplearning.ai | Reaches 800K+ ML engineers. Single mention = meaningful traffic for months. |
| 3 | **JavaScript Weekly** | 200K+ | STAS: AI senior architect for JS/TS repos. Auto-fix issues. | javascript@cooperpress.com | JS Weekly has highest dev-to-SaaS conversion. Strong JS/TS angle. |
| 4 | **Python Weekly** | 100K+ | AI that fixes GitHub issues automatically (Python support) | editor@pythonweekly.com | Python community is very active. Emphasize OSS angle. |
| 5 | **TLDR DevOps** | 150K+ | Open-source GitHub bot that auto-fixes issues | sponsors@tldr.tech | Cross-promo with TLDR AI. DevOps angle — reduce backlog. |

## Tier 2: Mid-Size Newsletters (20-100K subscribers)

Good effort-good return. More personal relationships possible.

| # | Newsletter | Subscribers | Pitch Angle | Contact | Notes |
|---|-----------|-------------|-------------|---------|-------|
| 6 | **DevTools Weekly** | 30K | STAS: open-source AI senior architect for GitHub | adrian@devtoolsweekly.com | Highest install-to-visitor conversion. Targeted devtools audience. |
| 7 | **Bytes (Swyx)** | 40K | Plan-first AI for issue resolution (open source AGPL) | swyx@swyx.io | Swyx is influential in devtools space. Personalize heavily. |
| 8 | **Node Weekly** | 80K+ | Auto-fix Node.js issues with AI (open source) | node@cooperpress.com | Strong Node.js angle. Part of Cooper Press network. |
| 9 | **Frontend Focus** | 60K+ | AI that fixes frontend bugs automatically | frontend@cooperpress.com | Growing frontend bug market. Good for Post 3 angle. |
| 10 | **Go Weekly** | 25K | Open-source AI code fix for Go repositories | editor@goweekly.com | Go community is small but engaged. Good for niche positioning. |
| 11 | **Rust Weekly** | 30K+ | AI-assisted debugging for Rust — open source | editors@rust-weekly.com | Rust devs are curious about AI. Honest angle (still improving). |
| 12 | **Ruby Weekly** | 50K+ | STAS: AI senior architect for Ruby repos | ruby@cooperpress.com | Ruby community loves OSS. Pitch open source + "it fixes your backlog". |

## Tier 3: Niche & Emerging (5-20K subscribers)

Low effort but high relevance. Good for testing messaging.

| # | Newsletter | Subscribers | Pitch Angle | Contact | Notes |
|---|-----------|-------------|-------------|---------|-------|
| 13 | **Engineering Leadership** | 15K | Give your team an AI senior architect — without the hiring budget | greger@engineeringleadership.com | Tech lead audience. Pitch productivity angle. |
| 14 | **Open Source Startup Podcast** | 12K | Building an AGPL-licensed AI devtool in public | podcast@ossstartup.com | Podcast interview opportunity. Long-form reach. |
| 15 | **AI Tool Report** | 15K | STAS: open-source AI that fixes GitHub issues | hi@aitoolreport.com | Curated AI tools list. Easy inclusion. |
| 16 | **Console.dev** | 12K | STAS: plan-first AI for automated issue resolution | hello@console.dev | Devtools-curated newsletter. Quality audience. |
| 17 | **Hacker Newsletter** | 10K | Open-source GitHub bot: label an issue, get a PR | kai@hackernewsletter.com | HN curation. Drives thoughtful traffic. |
| 18 | **Changelog Weekly** | 18K | Open-source dev tool for automated code review | editors@changelog.com | Developer podcast + newsletter. Good for founder interview. |

---

## Cold Email Templates

### Template A: Tier 1 (TLDR AI / The Batch / Major Weekly)

**Subject:** STAS: open-source AI that fixes GitHub issues (plans first, then codes)

Hi [Editor Name],

I'm reaching out because

I think your readers would find STAS interesting.

**What is STAS?** An open-source (AGPL v3) GitHub bot. You label an issue with `stas:fix`, and it
investigates your entire codebase, writes a fix, runs your tests, and opens a pull request. Think
"senior architect as a service" for teams that can't afford one.

**Why it's different:** Most AI coding tools (Copilot, Cursor) are reactive — they suggest code when
you type. STAS is proactive — it reads the full repository context (AST + dependency graph + git
history), produces a root-cause analysis plan, and only generates code after you approve the
approach.

**Stats:** 92% pass rate across 500+ OSS issues, ~60s per fix, $3.80 average cost.
**Languages:** TypeScript/JavaScript (first-class), Python (good), Rust/Go/Java (improving).

I'd love to offer a guest post, provide an interview, or simply a mention. Happy to tailor
the content to your audience.

Full details and the open-source repo: https://github.com/Aimino-Tech/solving_tickets_as_a_service

Thanks,
[Name]
[Title] @ AImino

---

### Template B: Tier 2 (DevTools Weekly, Bytes, Cooper Press network)

**Subject:** STAS — open-source AI senior architect for GitHub. Label an issue. Get a PR.

Hi [Editor Name],

I've been reading [newsletter] for a while and thought this might resonate with your audience.

We built STAS because we noticed a gap in AI dev tools: they help IF you know exactly what code to
write. But most dev time is spent figuring out WHAT to write, not writing it.

STAS fills that gap — it reads the full repo, identifies root causes, plans the fix, then
implements it. All open source (AGPL v3).

A few highlights:
- 92% fix pass rate on real GitHub issues (not SWE-bench)
- ~60s from issue label to PR
- $3.80 average cost per fix
- Works with private repos, monorepos, and CI/CD pipelines

I think your [audience segment] would find this particularly useful because
[personalized reason].

Would this be interesting for [newsletter]? Happy to write a guest post tailored to your readers.

Best,
[Name]

---

### Template C: Tier 3 (Niche newsleters, Podcasts, Community)

**Subject:** Quick thought for [newsletter name]

Hi [Name],

Loved [recent issue / episode / post about specific topic].

I'm building STAS — an open-source GitHub bot that auto-fixes issues using AI. Label a bug, get a
PR. We're different from Copilot/Cursor because we plan first, code second (full repo analysis →
root cause → plan → fix).

I think this fits [newsletter] because [specific reason related to their sub niche].

Would a 2-3 paragraph mention or a quick guest post work for your upcoming issues?

Thanks for considering,
[Name]

---

## Guest Post Pitches

### Pitch 1: Technical (for TLDR AI, Engineering blogs)

**Title:** How we built an AI that plans before it codes

**Angle:** Architecture deep-dive into separating code understanding from code generation.
Context window optimization, dependency graph analysis, hallucination detection. Technical
readers who want to understand how plan-first AI works under the hood.

**Why it works for this outlet:** TLDR AI readers are technically sophisticated and want to
understand new architectures.

### Pitch 2: Product Comparison (for JavaScript Weekly, DevTools Weekly)

**Title:** Automating JavaScript bug fixes with AI — what works, what doesn't

**Angle:** Honest comparison of STAS vs Copilot Workspace vs OpenHands for JS/TS projects.
What each tool does well, where they fail, and the economics of automated fixing.

**Why it works for this outlet:** JS Weekly readers are evaluating tools. Comparison content
drives high-intent traffic.

### Pitch 3: Positioning / Founder Story (for Bytes, Hacker Newsletter)

**Title:** Why we built an AI senior architect instead of another copilot

**Angle:** The fundamental insight that most AI dev tools optimize for code writing, but the
real bottleneck is code understanding. Personal founder story + product vision.

**Why it works for this outlet:** Swyx readers care about product philosophy and founder
stories. HN readers upvote opinion pieces with strong technical grounding.

---

## Outreach Schedule

### Phase 1: Relationship Building (T-4 weeks to T-3 weeks)

| Day | Action |
|-----|--------|
| Day 1 | Follow all target newsletters (subscribe if not already) |
| Day 1 | Engage with editors on Twitter/LinkedIn (like, comment, share) |
| Day 2 | Cold email Tier 3 (easier to get yes, use as warmup) |
| Day 3 | Cold email Tier 2 |
| Day 4-5 | Cold email Tier 1 (most prep needed) |
| Day 7 | Follow up on all non-responses |

### Phase 2: Content Delivery (T-2 weeks to T-1 week)

| Day | Action |
|-----|--------|
| Day 8-10 | Send guest post drafts to interested editors |
| Day 10-12 | Provide screenshots, data, and interview availability |
| Day 14 | Confirm publication dates and canonical URLs |

### Phase 3: Launch (T-0)

| Day | Action |
|-----|--------|
| Launch day | Share all published mentions on social media |
| Launch day | Send thank-you notes to editors |
| Launch +1 day | Monitor traffic from each source |
| Launch +7 days | Follow-up with non-responders (final attempt) |

### Follow-up Schedule

1. **First email** → Day 1
2. **First follow-up** → Day 5-6 (new angle or additional info)
3. **Second follow-up** → Day 12-14 (final ask, low pressure)
4. **No more follow-ups** → Respect their inbox

> Rule: Never send more than 3 emails total per contact. If they don't respond, they're not
> interested or too busy. Move on.

---

## Tracking

| Newsletter | Status | Contact Date | Response | Follow-up 1 | Follow-up 2 |
|-----------|--------|-------------|----------|-------------|-------------|
| TLDR AI | ❌ Not contacted | — | — | — | — |
| The Batch | ❌ Not contacted | — | — | — | — |
| JavaScript Weekly | ❌ Not contacted | — | — | — | — |
| Python Weekly | ❌ Not contacted | — | — | — | — |
| TLDR DevOps | ❌ Not contacted | — | — | — | — |
| DevTools Weekly | ❌ Not contacted | — | — | — | — |
| Bytes (Swyx) | ❌ Not contacted | — | — | — | — |
| Node Weekly | ❌ Not contacted | — | — | — | — |
| [Add more] | ❌ Not contacted | — | — | — | — |

---

## Success Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Total newsletters contacted | 18 | All tiers |
| Positive responses | 5+ | Interested or want more info |
| Confirmed mentions | 3+ | Before launch day |
| Traffic from mentions (Week 1) | 5-10K visits | Cross-reference with Plausible |
| Newsletter subscriber growth | +15% | From landing page signups |
| Conversion rate from newsletter | 2-5% | Free tier signups |
| Cost per acquisition | < $5 | Based on sponsorship costs |

---

## Notes & Best Practices

1. **Personalize every email.** Reference a recent issue of their newsletter. Generic pitches
   get ignored.
2. **Lead with value.** Explain why their readers will benefit. Not why STAS is great.
3. **Make it easy for them.** Provide pre-written copy, screenshots, and bullet points they
   can use directly.
4. **Canonical URLs matter.** Cross-posts on dev.to/Medium should link back to the STAS blog
   for SEO credit.
5. **Most newsletters book 2-4 weeks ahead.** Start outreach early.
6. **Editors change frequently.** Verify contact info before sending.
7. **If they say yes to a mention but no to a guest post, take the mention.**
8. **Track everything.** Use a CRM or spreadsheet to manage responses and follow-ups.
