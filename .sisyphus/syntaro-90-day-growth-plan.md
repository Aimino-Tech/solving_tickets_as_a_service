# SYNTARO 90-Day Growth Plan (SaaS-Only)

> **Context**: SaaS-only hosted service. No self-host. Powered by OpenCode + frontier models. Competitors (Plip, KintsugiBot) wrap Claude — the moat is the integrated pipeline.

---

## 1. Growth Flywheel

```
                         ┌─────────────────────────────────────┐
                         │        GITHUB MARKETPLACE           │
                         │  (primary acquisition channel)      │
                         └──────────────┬──────────────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────────────┐
                         │     INSTALL SYNTARO GITHUB APP         │
                         │  (free tier, 0-commit install)      │
                         └──────────────┬──────────────────────┘
                                        │
                         ┌──────────────▼──────────────────────┐
            ┌───────────►│      FIRST FIX EXPERIENCE           │◄────────────┐
            │            │  Label issue → PR in minutes        │            │
            │            │  "Wow, that actually works"         │            │
            │            └──────────────┬──────────────────────┘            │
            │                           │                                   │
            │            ┌──────────────▼──────────────────────┐            │
            │            │     FIX QUALITY PROVEN              │            │
            │            │  Tests pass. Merge happens.          │            │
            │            │  Dev trusts the tool.               │            │
            │            └──────┬──────────────────────┬───────┘            │
            │                   │                      │                    │
            │      ┌────────────▼────┐       ┌────────▼───────────┐         │
            │      │  VIRAL SPREAD   │       │  USAGE INTENSIFIES │         │
            │      │  PR footer:     │       │  More issues       │         │
            │      │  "Fixed by SYNTARO"│       │  labeled. Limits   │         │
            │      │  Word of mouth  │       │  approached.       │         │
            │      └─────────────────┘       └────────┬───────────┘         │
            │                   │                      │                    │
            │                   └──────┬───────────────┘                    │
            │                          │                                    │
            │            ┌─────────────▼──────────────────┐                 │
            │            │     UPGRADE EVENT HITS         │                 │
            │            │  10 fixes/mo limit reached     │                 │
            │            │  or team wants SSO/dashboard   │                 │
            │            └─────────────┬──────────────────┘                 │
            │                          │                                    │
            │            ┌─────────────▼──────────────────┐                 │
            │            │        PAID CONVERSION         │                 │
            │            │  Solo ($49) or Team ($149)      │                 │
            │            └─────────────┬──────────────────┘                 │
            │                          │                                    │
            │            ┌─────────────▼──────────────────┐                 │
            │            │  TEAM EXPANSION (NDR MOTOR)    │                 │
            │            │  More devs on team → more      │─────────────────┘
            │            │  fixes → seat/usage expansion  │
            │            └────────────────────────────────┘
```

### 5 Growth Loops (in priority order)

| Loop | Name | Mechanics | Viral Coefficient Contribution |
|------|------|-----------|-------------------------------|
| **L1** | **GitHub-to-SYNTARO** | Dev discovers SYNTARO on GitHub Marketplace → 1-click install → labels first issue → fix appears → PR footer "Fixed by SYNTARO" → other devs see it → they install too | 0.15-0.20 |
| **L2** | **Team Viral** | Individual dev on free tier → invites teammates (needed for code review) → more devs use SYNTARO → team hits limit → org upgrade | 0.10-0.15 |
| **L3** | **Content Flywheel** | Every fix creates a case study → blog post / tweet → more devs → more installs → more fixes → more content | 0.05-0.08 |
| **L4** | **Social Proof** | Fix success rate → benchmark comparisons → HN/Reddit posts → virality among dev community | 0.05-0.10 |
| **L5** | **Ecosystem** | OpenCode plugin → OpenSymphony integration → co-lleague ecosystem → cross-product adoption | 0.02-0.05 |

**Target combined k-factor (Q3): 0.35–0.50**

---

## 2. Pricing Tiers

### Revised SaaS Pricing (vs current STRATEGY.md)

| Tier | Price | Fixes/mo | Repos | Model | Dashboard | Support | Key Friction Point |
|------|-------|----------|-------|-------|-----------|---------|-------------------|
| **Free** | $0 | 10 | 1 | Frontier models (base) | No | Community | Hits fix limit → upgrade itch |
| **Solo** | $49/mo | 50 | Unlimited | Frontier models (priority) | Basic analytics | Email | Outgrows 100 fixes |
| **Team** | $149/mo | 200 | Unlimited | Frontier models (priority) | Team analytics, audit log | Slack + Email | Needs SSO |
| **Enterprise** | Custom | Custom | Unlimited | Dedicated inference | Everything | SLA, SSO, VPC | Compliance needs |

### Why these prices?

| Competitor | Free Fixes | Paid Entry | Paid Fixes | SYNTARO Diff |
|-----------|-----------|-----------|-----------|-----------|
| **Plip** | 10/mo | $39/mo (25 fixes) | $399/mo (100 fixes) | SYNTARO at $49 gives 100 fixes vs Plip's 25 |
| **KintsugiBot** | 10/mo | $5/mo (100 fixes) | N/A | SYNTARO uses frontier models (50% better), not Claude |
| **Open SWE** | BYO API | BYO API | BYO API | No hosted SaaS alternative |

### Free Tier Design (Conversion-Optimized)

| Parameter | Setting | Rationale |
|-----------|---------|-----------|
| Fixes per month | **10** | Matches Plip. Enough to prove value. Not enough for daily use. |
| Repos | **1** | Forces single-repo evaluation. Upgrade unlocks full power. |
| Model quality | **Frontier models** (same as paid) | MUST show best quality on free tier. The pipeline quality is the moat. |
| Credit card | **Not required** | Reduces friction. Devs install and try immediately. |
| Dashboard | **Read-only** | See runs/status but no export. Upgrade unlocks full analytics. |
| Onboarding email | **Optional** | Capture email for drip campaigns. Not mandatory. |
| Trial period | **N/A** (persistent free) | Freemium, not time-limited trial. Better for dev tool virality. |

### Upgrade Triggers (Engineered Friction Points)

| Trigger | From → To | % of Converts |
|---------|----------|---------------|
| Hits 10-fix limit mid-month | Free → Solo ($49) | 40% |
| Wants to add 2nd repo | Free → Solo ($49) | 25% |
| Needs dashboard analytics | Free → Solo ($49) | 15% |
| Outgrows 50 fixes/mo | Solo → Team ($149) | 10% |
| Wants SSO/audit | Team → Enterprise | 5% |
| Needs 200+ fixes/mo | Solo → Enterprise | 5% |

---

## 3. KPI Targets per Quarter

### Core Metrics

| Metric | Q1 (Launch†) | Q2 (Grow) | Q3 (Scale) | Benchmark Source |
|--------|-------------|----------|-----------|-----------------|
| Active repos | 500 | 2,000 | 5,000 | Plip: ~500 after 6mo (est.) |
| Free installs (cumulative) | 2,500 | 8,000 | 20,000 | GitHub Marketplace avg |
| Monthly active repos | 200 | 800 | 2,000 | ~40% of installed use monthly |
| Fix completion rate | 60% | 70% | 80% | Current: 70% target. Aim higher. |
| Time-to-fix (median) | <10 min | <7 min | <5 min | Plip claims "minutes" |
| Free → Paid conversion | 5% | 10% | **15%** | Dev tools PLG: 3-5% median. 15% = GREAT. |
| Paid accounts | 125 | 800 | 3,000 | 20K installs × 15% = 3K |
| MRR | $6,125 | $49,200 | $147,000 | Solo avg $49, Team avg $149 weighted |

### Conversion Funnel (Q3 Target)

```
GitHub Marketplace page views  100,000
         │  (visit-to-install: 20%)
         ▼
App installs                    20,000
         │  (install-to-label: 50%)
         ▼
Repos that label an issue      10,000
         │  (label-to-fix: 80%)
         ▼
Fixes attempted                  8,000
         │  (fix-completion: 80%)
         ▼
Successful PRs created          6,400
         │  (PR-to-merge: 70%)
         ▼
PRs merged                      4,480
         │  (merge-to-upgrade-trigger: 60%)
         ▼
Users hitting free limit        2,688
         │  (limit-to-paid: 55%)
         ▼
Paid users                      1,478  (per month from this cohort)
```

### Quality Metrics

| Metric | Q1 | Q2 | Q3 | Target Justification |
|--------|-----|----|-----|---------------------|
| Fix pass rate (tests + regression) | 70% | 78% | 85% | Frontier models projected 90%+ at steady state |
| Fix merge rate | 55% | 65% | 75% | Lower initially as bot earns trust |
| Median time from label to PR | 8 min | 5 min | 3 min | Sandbox infra optimization |
| User satisfaction (NPS) | +30 | +45 | +55 | Top dev tools hit +50-70 |
| Churn (monthly) | 8% | 5% | 3% | Goal: below dev tools median of 5-7% |
| Net Dollar Retention (NDR) | 100% | 110% | 125% | Dev tools top-quartile: 140% |

### Revenue Projection

| | Q1 | Q2 | Q3 | Q4 (projected) |
|---|---|---|---|---|
| Free users | 2,375 | 7,200 | 17,000 | 40,000 |
| Paid Solo ($49) | 100 | 640 | 2,400 | 6,000 |
| Paid Team ($149) | 25 | 160 | 600 | 1,500 |
| MRR | ~$6,125 | ~$49,200 | ~$147,000 | ~$382,500 |
| ARR | ~$73,500 | ~$470,400 | ~$1.76M | ~$4.59M |

---

## 4. Viral Coefficient Targets

### K-Factor Breakdown

| Viral Loop | Invites (i) | Conversion (c) | k = i × c | Timeline to Mature |
|-----------|------------|----------------|-----------|-------------------|
| PR footer "Fixed by SYNTARO" | 50 impressions × 2% click → 1 visit | 20% install rate | **0.20** | Immediate (launch) |
| Team invite (collaboration) | 1 invite per 3 users | 30% conversion | **0.10** | Q2+ |
| Content/case study sharing | 0.5 shares per user | 20% conversion | **0.10** | Q2+ |
| GitHub star referral | 0.3 stars → installs | 15% conversion | **0.05** | Q1+ |

| Phase | Target Combined k-factor | Growth Type |
|-------|-------------------------|-------------|
| Q1 (Launch) | **0.20** | Linear growth (new installs = PR footer only) |
| Q2 (Grow) | **0.30** | Linear + slight compounding (team invites + content) |
| Q3 (Scale) | **0.40** | Near-exponential (all loops mature) |
| Mature target | **0.50+** | Sustainable compounding growth |

> **Context**: B2B benchmark: >0.2 = good, >0.4 = great, >0.7 = outstanding. Slack hit 8.5 (team invites). Dropbox hit 1.0+ (storage referral). Square succeeded with 0.01. For a dev tool with PR footers as built-in organic distribution, 0.35-0.50 is ambitious but achievable.

### Viral Mechanics Built Into Product

1. **PR footer**: "This fix was automatically generated by [SYNTARO](https://syntaro.dev). Label an issue with `syntaro:fix` to get your own AI fix." — *Every PR = ad impression*
2. **Team collaboration gate**: Free tier = single user. To collaborate on fixes, invite team → they install → they get their own free tier → eventual upgrade
3. **Shareable fix reports**: Auto-generated "How SYNTARO fixed this" pages with benchmark stats. Devs share them socially.
4. **GitHub star-to-install funnel**: Track stars → send "Thanks for starring! Try SYNTARO" via GitHub bot comment on starred issues
5. **Embedded tweet button**: After successful fix merge → "Tweet that SYNTARO just fixed my bug" → auto-populated with hashtag

---

## 5. Channel Strategy

### Channel Prioritization Matrix

| Channel | Cost | Time to Result | Volume | Quality (Conversion) | Priority |
|---------|------|---------------|-------|---------------------|----------|
| GitHub Marketplace | $0 | 1 week | Very High | High | **P0** |
| Hacker News Launch | $0 | 1 day | Very High | High | **P0** |
| Product Hunt | $0 | 1 day | High | High | **P1** |
| Dev Newsletters (TLDR, etc.) | $500-2K | 1 month | High | Medium | **P1** |
| Technical Blog Posts | $0 (time) | 2-4 weeks | Medium | Very High | **P1** |
| Reddit (r/programming) | $0 | 1 day | High | Medium | **P2** |
| Twitter/X Developer Community | $0 | Ongoing | Medium | Medium | **P2** |
| YouTube/Dev Tutorials | $0 (time) | 4-8 weeks | Low | High | **P3** |
| Paid Ads (Google/GitHub) | $5-20K/mo | 1 month | Medium | Low | **P3** |

### Detailed Execution Plan

#### Week 1-2: GitHub Marketplace Launch (P0)

- [ ] Submit GitHub App for Marketplace listing approval
- [ ] Write compelling Marketplace description (focus on: "50% better than GPT-5.5, 100% automatic")
- [ ] Add 3-5 screenshots showing before/after fix
- [ ] Create a 30s demo GIF: label issue → watch → PR appears
- [ ] Set up Marketplace billing integration (GitHub handles Stripe for first 10K)
- [ ] Implement "Install for free" CTA → GitHub OAuth → one-click

**Expected**: 500-1,000 installs in first 2 weeks. Primary acquisition channel.

#### Week 3-4: Hacker News Launch (P0)

- [ ] Prepare HN post: "Fixes GitHub issues with AI (and it's free)"
- [ ] Key narrative angles:
  - "50% better than GPT-5.5 on the hardest coding benchmark"
  - "Open source bot → hosted SaaS with our proprietary AGI"
  - "Label an issue, get a PR. That's it."
- [ ] Have a benchmark comparison chart ready (deepSWE scores)
- [ ] Prepare for AMA in comments
- [ ] Coordinate with co-lleague team for cross-upvotes

**Expected**: 500-2,000 installs from HN traffic. Second highest quality channel.

#### Week 5-6: Product Hunt Launch (P1)

- [ ] Prepare PH listing with demo video
- [ ] Recruit PH hunter (aim for top 10 hunters)
- [ ] Pre-write comments from beta users/testimonials
- [ ] Launch on Tuesday morning (best PH day)
- [ ] Cross-promote with OpenCode/Aimino network

**Expected**: 200-500 installs. Good for SEO and social proof.

#### Week 7-12: Content + Community (P1)

- [ ] **Dev Newsletters**: Submit to TLDR (150K+ devs), Python Weekly, Node Weekly, Go Weekly, Rust Weekly
- [ ] **Technical blog**: "How we built SYNTARO: The architecture behind an AGI that fixes code" (1800 words + diagrams)
- [ ] **Benchmark post**: "SYNTARO vs Plip vs KintsugiBot: We tested all 3 on 100 real GitHub issues" (sponsor on dev.to)
- [ ] **Case studies**: Solicit from early users. "How [company] saved 40h/week with automated bug fixes"
- [ ] **Reddit**: r/programming, r/github, r/MachineLearning. Prepare for each subreddit's tone/style.
- [ ] **Twitter/X**: Daily SYNTARO fix screenshots. Tag the fixed repo's maintainers. Build "SYNTARO fixed this" collection.

#### Ongoing (Weeks 1-12): DevRel + OpenCode Ecosystem

- [ ] Post in OpenCode Discord regularly
- [ ] Contribute to opencode-plugin discussions
- [ ] Create "SYNTARO + OpenCode" tutorial videos
- [ ] Recruit beta testers from OpenCode power users
- [ ] Engage with every GitHub issue, PR, and mention

### Content Calendar (12 Weeks)

| Week | Channel | Content | Responsible |
|------|---------|---------|-------------|
| 1 | GitHub Marketplace | Listing live, demo GIF | Engineering |
| 2 | Blog | "SYNTARO: Architecture of an AGI bug-fixing bot" | DevRel |
| 3 | Hacker News | Launch post + AMA | Founder |
| 4 | Product Hunt | PH listing + demo video | Founder |
| 5 | TLDR Newsletter | Paid submission ($2K) | Marketing |
| 6 | Dev.to | "We tested SYNTARO vs Plip vs KintsugiBot" | DevRel |
| 7 | Reddit | r/programming: "This bot fixes bugs automatically" | Founder |
| 8 | Case Study | First paying customer story | Marketing |
| 9 | Twitter/X | "SYNTARO fixed this" thread collection | Marketing |
| 10 | YouTube | "SYNTARO in 5 minutes" setup tutorial | DevRel |
| 11 | Newsletter | Monthly benchmark update + growth stats | Marketing |
| 12 | GitHub | 5K stars celebration + retrospective post | Founder |

---

## 6. Conversion Optimization (CRO) Playbook

### Free → Paid Conversion Funnel

```
Visitor lands on syntaro.dev
        │ Install CTA (primary: "Install for Free on GitHub")
        ▼
GitHub OAuth (1 click)
        │ "SYNTARO wants to access repos"
        ▼
Select repo (or "All repos")
        │ Onboarding wizard
        ▼
Label first issue with syntaro:fix
        │ "We're working on it!" comment
        ▼
Watch fix in real-time (live progress in issue)
        │
        ▼
PR appears with fix + tests
        │ "This was fixed by SYNTARO"
        ▼
User reviews PR, asks "Can it do more?"
        │ In-app push: "You've used N of 10 free fixes"  
        ▼
Fix limit hit → paywalled
        │ "Upgrade to Solo for 50 fixes/mo and unlimited repos"
        ▼
[OPTIONAL] At 8/10 fixes → proactive email:
        "You're almost out of free fixes. Upgrade now to keep going."
        ▼
[CONVERSION] Paid plan activated
```

### Key Conversion Levers

| Lever | Tactic | Expected Lift |
|-------|--------|--------------|
| Usage meter | Show remaining fixes prominently in app | +15% conversion |
| Proactive email | "You've used 8/10 fixes. Don't lose momentum." | +20% conversion |
| First-week onboarding | Email series: Day 1 (thanks), Day 3 (power tips), Day 7 (case study) | +10% conversion |
| Merge celebration | "Congrats! Your PR merged. Want more fixes?" CTAs | +8% conversion |
| Team invite gate | "Invite your team to collaborate on fixes" → more installs | +5% conversion |
| Benchmark popup | "SYNTARO fixed this in 3 minutes. Plip took 12." | +12% conversion |

### PQL Signal Detection (Target: 3x conversion improvement)

Track the following signals to identify Product-Qualified Leads:

| Signal | Weight | Action |
|--------|--------|--------|
| Used 8+ fixes in a week | High 🔴 | Send personalized upgrade email + free week trial of Solo |
| Labeled issues on 3+ repos | High 🔴 | Suggest Team plan (unlimited repos) |
| Asked for dashboard in feedback | Medium 🟡 | Offer Solo trial with dashboard preview |
| Team member requested invite | Medium 🟡 | Convert via team expansion |
| Had 3+ PRs merged in a week | High 🔴 | Proactive outreach: "Need more fixes?" |
| Left a public review/star | Low 🟢 | Send thank-you + upgrade offer |

**Target**: 30%+ PQL-to-paid conversion rate (vs 5% baseline without PQLs).

---

## 7. Unit Economics & Sustainability

### Cost Structure

| Cost Item | Unit | Free User | Solo ($49) | Team ($149) |
|-----------|------|-----------|------------|------------|
| AGI inference | ~$3/fix | $0 (10 fixes × $3 = $30 cost) | $0 up to 25 fixes, then $3/fix | $0 up to 100 fixes, then $3/fix |
| Sandbox compute | ~$0.50/fix | $5 | $25 | $50 |
| Hosting + infra | Fixed | ~$0.01 | ~$0.20 | ~$0.50 |
| **Total cost** | | **~$30 (loss leader)** | **~$25 (variable)** | **~$50 (variable)** |
| **Revenue** | | **$0** | **$49** | **$149** |
| **Gross margin** | | **-∞** | **~36%** (at 50 fixes) | **~49%** (at 200 fixes) |

### Path to Profitability

| Metric | Q1 | Q2 | Q3 | Target (Q4) |
|--------|-----|----|-----|-------------|
| Free users | 2,375 | 7,200 | 17,000 | 40,000 |
| Avg free fixes/user/mo | 4 | 5 | 6 | 7 |
| Total free fix cost | ~$28,500 | ~$108,000 | ~$306,000 | ~$840,000 |
| Paid users | 125 | 800 | 3,000 | 7,500 |
| Paid fix cost | ~$3,125 | ~$20,000 | ~$90,000 | ~$262,500 |
| Total cost | ~$31,625 | ~$128,000 | ~$396,000 | ~$1.1M |
| Total revenue | ~$6,125 | ~$49,200 | ~$147,000 | ~$382,500 |
| **Net margin** | **-80%** | **-69%** | **-63%** | **-66%** |

> **Reality check**: Free tier is a loss leader. Path to profitability requires:
> 1. Reducing inference cost from $3/fix → $1/fix (model optimization)
> 2. Increasing paid conversion from 15% → 20%
> 3. Enterprise tier ($500+/mo) for high-volume users
> 4. PQL-driven upgrade interventions (target: 30% conversion on PQLs)

---

## 8. Launch Week Checklist (Days 1-7)

| Day | Action | Owner | Metric |
|-----|--------|-------|--------|
| D-7 | GitHub Marketplace listing submitted | Engineering | Approved |
| D-5 | HN post drafted + reviewed by team | Founder | Ready to post |
| D-3 | Benchmark comparison landing page live | Marketing | syntaro.dev/benchmarks |
| D-2 | Product Hunt draft submitted for review | Marketing | Ready |
| D-1 | Email list of beta users for launch day engagement | Marketing | 50+ beta users |
| **D-0 (LAUNCH)** | HN post goes up at 9 AM ET | Founder | Front page |
| D-0 | Post on Reddit r/programming | Founder | 100+ upvotes |
| D-0 | Tweet thread from @syntaro_dev | Marketing | 10K impressions |
| D+1 | Monitor HN comments, respond to all | Founder | Every comment answered |
| D+1 | Fix critical bugs from launch feedback | Engineering | <2h response |
| D+2 | PH listing goes live (Tuesday) | Marketing | Top 5 product |
| D+3 | Beta user email: "Thanks + share your story" | Marketing | 10% response |
| D+5 | TLDR newsletter goes out | Marketing | 150K impressions |
| D+7 | Launch retrospective + metrics posted | Founder | Blog post |

---

## 9. Competitor Response Matrix

| Competitor Move | SYNTARO Response | Timeline |
|----------------|---------------|----------|
| Plip drops price | Match or undercut. Our margins are better (frontier models are cheaper than Claude). | 48h |
| KintsugiBot adds hosted tier | Highlight AGI quality gap (50% better). Offer free migration. | 1 week |
| GitHub builds native fix bot | Differentiate on AGI quality + OpenCode ecosystem. GitHub builds for scale, we build for quality. | Ongoing |
| New competitor enters | Benchmark comparison: SYNTARO vs [competitor]. The pipeline quality grows faster than they can catch up. | 2 weeks |
| Claude/GPT models improve | The pipeline and model routing improve too. The gap compounds — we're not wrapping, we're building. | Ongoing |

---

## 10. Growth Dashboard (Metrics to Track Daily)

| Metric | Daily Target | Where to Track |
|--------|-------------|----------------|
| New installs | 30+ (Q1) → 200+ (Q3) | GitHub Marketplace API |
| Active repos (labeled issue in 7d) | 10+ (Q1) → 100+ (Q3) | Internal analytics |
| Fix completion rate | >60% (Q1) → >80% (Q3) | Internal analytics |
| Free to paid conversion | 5% (Q1) → 15% (Q3) | Stripe |
| MRR | $6K (Q1) → $147K (Q3) | Stripe |
| First fix time (median) | <10 min (Q1) → <5 min (Q3) | Internal analytics |
| PR merge rate | >55% (Q1) → >75% (Q3) | GitHub API |
| PR footer impressions | 100/day (Q1) → 5,000/day (Q3) | GitHub API |
| Churn | <8% (Q1) → <3% (Q3) | Stripe |
| NPS | +30 (Q1) → +55 (Q3) | Survey |

---

## Summary: Why This Will Work

**Market timing**: Dev tools using AI to automate code work is exploding. Plip's entry validated willingness to pay. Cursor's $40B valuation proves developer tooling can be huge.

**Our advantage**: 50% better AGI than GPT-5.5. Every competitor wraps Claude/GPT. We have the better model. The growth plan is built to turn that quality advantage into organic installs, viral spread, and paid conversion.

**15% conversion target is aggressive but achievable**: Dev tools median is 3-5%. But AI-native products hit 15-20% (Cursor hit 35%). Our free tier shows the full quality — devs who experience the quality will pay to keep using it.

**Key risk**: Free tier cost. At $3/fix inference, 10 free fixes = $30 cost. We need PQL-driven upgrade interventions fast and need to drive inference cost to $1/fix within 6 months.
