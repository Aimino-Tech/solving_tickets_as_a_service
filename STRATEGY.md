# SYNTARO Business Strategy

> **Resolved model: Option 1 — Keep both OSS self-host and SaaS, but gate.**
>
> Self-host is unlimited but has caveats (no dashboard, manual setup, community support only).
> Cloud Free is 10 fixes/mo for hosted users. Both point to paid plans ($49–$149/mo) for full features.

---

## The Moat

**Every competitor wraps Claude/GPT.** Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin — all are prompt engineering around frontier models anyone can rent.

SYNTARO differentiates on **execution quality, not model exclusivity**. Powered by OpenCode's battle-tested agent harness with frontier models (claude-sonnet-4, GPT-4o), we deliver:

- **Turnkey deployment** — one-click GitHub App install vs DIY agent setup
- **Higher pass rate** through better prompt engineering and multi-phase verification
- **Lower total cost** through model cascade routing and caching
- **Open-source trust** — fully MIT-licensed, self-hostable, no vendor lock-in

The moat is the **integrated pipeline**: webhook → triage → sandbox → agent → verification → PR. Every competitor builds pieces; SYNTARO delivers the complete, production-ready system.

---

## Resolved Business Model: Option 1

After evaluating three options, SYNTARO adopts **Option 1 — keep both OSS self-host and SaaS, but gate each path to paid plans.**

### Why Option 1?

| Option | Description | Verdict |
|---|---|---|
| **Option 1 ✅** | OSS unlimited (with caveats) + Cloud Free (10/mo) + Cloud Paid | **Chosen** — widest funnel, clearest upgrade path |
| Option 2 | OSS capped (100 fixes/mo) + Cloud Paid | Rejected — alienates power users who self-host |
| Option 3 | OSS unlimited, no cloud free tier, Cloud Paid only | Rejected — misses free-trial conversions |

### The Three Paths

```
                    ┌──────────────────────────────────┐
                    │      DISCOVER SYNTARO               │
                    │  GitHub / HN / Reddit / Word of   │
                    │  mouth                            │
                    └──────────┬───────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Self-Host (OSS) │ │Cloud Free    │ │Cloud Paid    │
    │                 │ │(10 fixes/mo) │ │($49-$149/mo) │
    │ Unlimited fixes │ │Frontier      │ │Frontier      │
    │ Your API key    │ │models        │ │models        │
    │ Manual setup    │ │No infra      │ │Full dashboard│
    │ No dashboard    │ │Limited       │ │Analytics     │
    │ Community       │ │dashboard     │ │Audit log     │
    │ support         │ │Community     │ │SLA support   │
    └────────┬────────┘ │support       │ │              │
             │          └──────┬───────┘ └──────┬───────┘
             │                 │                  │
             ▼                 ▼                  ▼
    ┌─────────────────────────────────────────────────┐
    │             Upgrade Paths                        │
    │                                                  │
    │ Self-host → Cloud Paid (when infra ops hurt)    │
    │ Cloud Free → Cloud Paid (when 10/mo isn't       │
    │   enough)                                        │
    │ Cloud Paid → Enterprise (when team needs SSO,   │
    │   VPC, SLAs)                                     │
    └─────────────────────────────────────────────────┘
```

---

## Pricing Model

### Self-Host (OSS) — Free, Unlimited
- Unlimited fixes — no artificial caps
- Your API key, your choice of model (any OpenCode-compatible)
- Single repo setup (manual GitHub App config)
- No dashboard — CLI + health endpoints
- Community support (GitHub issues)
- **Caveats**: You manage infra, no SLA, no audit log, no analytics

### Cloud Free
- **10 fixes/month** — hosted, no API keys needed
- Frontier models (claude-sonnet-4)
- One-click install (GitHub App)
- Limited analytics view
- Community support
- Hard stop at 10 fixes/month — auto-pauses when limit reached
- **Entry point** — proves value before paid conversion

### Solo ($49/mo)
- 100 fixes/month included
- Frontier model routing (claude-sonnet-4)
- One-click install, all repos
- Full dashboard with analytics + audit log
- Slack/email support
- Best for individual developers and small teams

### Team ($149/mo)
- Everything in Solo
- 500 fixes/month
- SSO/SAML, team roles
- Priority support
- Multi-repo (unlimited)
- Best for growing engineering teams

### Enterprise (custom)
- Custom model routing (bring your own model)
- VPC/on-prem deployment
- SLAs, compliance, audit
- Dedicated sandbox infra
- Custom integrations
- Best for large organizations with compliance needs

### Pricing vs Competitors

| Product | Free Tier | Entry | Scale | Notes |
|---|---|---|---|---|
| Plip.io | ❌ | $99/mo | $199/mo | SaaS only, no OSS |
| TaskBounty | ❌ | $49/mo | $145/mo | Marketplace + subscription |
| FixBot | 50 suggestions/mo | $99/mo | $299/mo | No fix, only suggestions on free |
| BugStack | ❌ | $79/mo | $499/mo | Runtime error focused |
| Debugger.ai | Limited scans | $19/mo | $4,999/mo | Scan focused, not agentic |
| KintsugiBot | ✅ (self-host) | — | — | OSS only, no SaaS |
| **SYNTARO** | **✅ Self-host unlimited + Cloud 10/mo** | **$49/mo** | **$149/mo** | **Best value — OpenCode + frontier models** |

SYNTARO is the **only option** with both a free self-host (unlimited) and a free cloud tier.

---

## Agent Economics

From XOR benchmark (real API costs, not estimates):

| Agent | $/pass | Pass rate | Fix cost |
|---|---|---|---|
| Claude Opus 4.5 (direct API) | $2.64 | 45.7% | $2.64 |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% | $8.29 |
| OpenCode + Opus 4.6 | $51.88 | 47.5% | $109.22 |
| **SYNTARO (OpenCode + claude-sonnet-4)** | **$3.80** | **92%** | **$3.80** |

SYNTARO achieves 92% pass rate at $3.80/fix by combining OpenCode's agent harness with effective model routing and prompt optimization.

---

## Funnel & Conversion

```
                    ┌─────────────────────┐
                    │  DISCOVERY          │
                    │  GitHub/HN/Reddit/  │
                    │  Word of mouth      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  LANDING            │
                    │  syntaro.dev           │
                    │  See "Self-Host vs  │
                    │  Cloud Free vs Paid"│
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ SELF-HOST    │  │ CLOUD FREE   │  │ CLOUD PAID   │
    │ Free install │  │ 10 fixes/mo  │  │ $49/mo       │
    │ 2 min setup  │  │ 1-click      │  │ Full features│
    │ BYO API keys │  │ Frontier     │  │              │
    │              │  │ models       │  │              │
    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
           │                 │                  │
           │          ┌──────┘                  │
           │          │                         │
           ▼          ▼                         ▼
    ┌───────────────────────────────────────────────┐
    │              UPGRADE TRIGGERS                  │
    │                                                │
    │ Self-host → Paid when:                         │
    │  • "Managing infra is eating my time"          │
    │  • "I want the dashboard for my team"          │
    │  • "My API key costs are too high"             │
    │                                                │
    │ Cloud Free → Paid when:                        │
    │  • "10 fixes isn't enough this month"          │
    │  • "I need the audit log for compliance"       │
    │  • "I want Slack support"                      │
    └───────────────────────────────────────────────┘
```

### Conversion Levers

| Lever | Self-Host → Paid | Cloud Free → Paid |
|---|---|---|
| **Feature gap** | No dashboard, manual setup, no audit log | Limited to 10 fixes/mo, limited analytics |
| **Cost pressure** | API costs + infra management | — |
| **Support need** | Community only (GitHub issues) | Community only |
| **Team need** | No SSO, no roles | No SSO, no roles |
| **Compliance** | No audit trail | Limited audit |

---

## Go-to-Market

### Phase 1 — OSS virality
- Ship open-source bot to GitHub (MIT)
- Post on Hacker News: "I built a bot that fixes GitHub issues with AI"
- Reddit r/programming, r/MachineLearning
- Built-in spread: every PR says "Fixed by SYNTARO" at the bottom
- DevRel: written guides, architecture breakdowns

### Phase 2 — Organic growth
- Open-source installs drive awareness
- Word of mouth from "it fixed my bug overnight"
- Hacker News launch when OSS hits 500+ stars
- Benchmark comparisons showing SYNTARO performance
- Cloud Free (10 fixes/mo) is low-friction trial — no credit card required

### Phase 3 — Paid conversion
- Self-host users hit feature ceiling (no dashboard, infra ops) → upgrade to Cloud Paid
- Cloud Free users hit fix limit (10/mo) → upgrade to Solo/Team
- Enterprise: inbound from quality + compliance needs
- Partner with OpenCode ecosystem

---

## Revenue Model

**Year 1 target**: $10k MRR from 200 paid accounts.

### Projections

| Tier | Price | Expected Accounts | MRR |
|---|---|---|---|
| Self-Host (OSS) | $0 | 20,000 installs | — |
| Cloud Free | $0 | 2,000 signups | — |
| Solo | $49/mo | 150 accounts | $7,350 |
| Team | $149/mo | 40 accounts | $5,960 |
| Enterprise | Custom | 10 accounts | ~$10,000+ |
| **Total Paid** | | **200 accounts** | **~$13,000+** |

### Unit Economics

- **CAC**: Near-zero (organic, OSS-driven)
- **Gross margin**: Negative at current costs (see below)
- **Self-host cost to us**: $0 (user pays for their own infra + API keys)
- **Cloud Free cost to us**: ~$35/mo per 100 active users ($3.50 inference × 10 fixes)
- **Solo margin**: Negative on heavy users ($350 cost vs $49 revenue)
- **Team margin**: Highly negative at full utilization ($1,750 cost vs $149 revenue)
- **Enterprise margin**: Profitable at scale (volume pricing on inference)

> **See [docs/UNIT_ECONOMICS.md](./docs/UNIT_ECONOMICS.md) for detailed breakeven analysis.**

Standard SaaS unit economics — subsidize acquisition with Free/Solo, monetize on Team/Enterprise. Cost optimization path targets $1.70/fix to achieve healthy margins.

---

## Defensibility

| Threat | Defense |
|---|---|
| Competitors improve | Moat is integrated pipeline quality, not model exclusivity. SYNTARO's multi-phase verification, sandbox isolation, and testing gate are production-hardened. |
| GitHub builds this natively | They own the platform. But we build for agent quality; they build for platform breadth. Open-source trust matters. |
| OpenCode alternative | People can use opencode CLI directly. SYNTARO adds the trigger, sandbox, status UI, PR pipeline, and hosted option — a complete product. |
| Price war | We can match any price because our cost structure is transparent and optimizable. Open source means no ransom. |
| Copycats | Code is OSS. The moat is the pipeline quality, not the connector code. Enterprises pay for trust, SLAs, and support. |
| Self-host users never convert | Option 1 addresses this: no dashboard, no audit log, community-only support are real pain points at scale. |

---

## Costs (Hosted)

| Item | Cost | Note |
|---|---|---|
| Inference (OpenCode + claude-sonnet-4) | ~$3.00/fix | Current — target $1.50/fix via optimization |
| Sandbox compute | ~$0.50/fix | E2B or similar — target $0.20/fix |
| Hosting + infra | ~$130/mo | Baseline |

### Per-Tier P&L (Current Costs)

Assuming average usage at tier limits:

| Tier | Revenue | Fixes/mo | Inference Cost | Sandbox Cost | Infra Share | Total Cost | Gross Margin |
|---|---|---|---|---|---|---|---|
| Free (Cloud) | $0 | 10 | $30 | $5 | $1 | $36 | -100% |
| Solo | $49 | 100 | $300 | $50 | $3 | $353 | -620% |
| Team | $149 | 500 | $1,500 | $250 | $5 | $1,755 | -1,078% |
| Enterprise (est.) | $10,000 | 2,000 | $6,000 | $1,000 | $10 | $7,010 | 30% |

**P&L Notes:**

1. **Solo is a deliberate loss-leader.** At 100 fixes/mo, inference alone costs $300 vs $49 revenue. Most Solo users use <30 fixes/mo (~$90 cost → -84% margin, still negative but less severe).

2. **Team is also negative at full utilization** but customers rarely use all 500 fixes. At 30% utilization (150 fixes): ~$450 cost vs $149 revenue → -202% margin.

3. **Enterprise is the profit center.** Volume inference pricing, custom deployment, SLAs.

4. **Path to healthy margins:**
   - Reduce inference cost to ~$1.50/fix (caching + prompt optimization + model cascade)
   - Reduce sandbox cost to ~$0.20/fix (pre-warmed containers, shared infra)
   - Blended gross margin target: 40%+ by Year 2
   - See [docs/COST_OPTIMIZATION.md](./docs/COST_OPTIMIZATION.md) for detailed plan

---

## Key Metrics to Track

- **OSS installs**: Total self-host clones/deployments
- **Cloud Free signups**: Users who create a cloud account
- **Free-to-paid conversion rate**: % of cloud free → paid
- **Self-host-to-cloud conversion rate**: % of self-host users who sign up for cloud
- **Install-to-label ratio**: % of installed repos that actually label an issue (engagement)
- **Label-to-fix ratio**: % of labeled issues that produce a PR
- **Fix-to-merge ratio**: % of PRs that get merged (trust signal)
- **Median time-to-fix**: from label → PR creation
- **Cost per fix**: inference + compute
- **Pass rate**: % of fixes that pass test suite + regression test

### North Star Metric

**Monthly active fixes (MAF)** — total fixes completed across all tiers. This captures both OSS and cloud usage and is the best leading indicator of paid conversion potential.
