# STAS Business Strategy

> **Resolved model: Option 1 — Keep both OSS self-host and SaaS, but gate.**
>
> Self-host is unlimited but has caveats (no dashboard, manual setup, community support only).
> Cloud Free is 10 fixes/mo for hosted users. Both point to paid plans ($49–$149/mo) for full features.

---

## The Moat

**Every competitor wraps Claude/GPT.** Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin — all of them are just prompt engineering around frontier models that anyone can rent. None has a better model.

We do. Our AGI outperforms GPT-5.5 by 50% on DeepSWE — the first benchmark that actually measures real coding ability (668 LOC avg, 91 repos, 5 languages, no gold-solution cheating).

That 50% edge is the entire business. It means:
- **Higher pass rate** at the same cost
- **Lower cost** for the same pass rate
- **More complex tasks** that competitors can't handle

---

## Resolved Business Model: Option 1

After evaluating three options, STAS adopts **Option 1 — keep both OSS self-host and SaaS, but gate each path to paid plans.**

### Why Option 1?

| Option | Description | Verdict |
|---|---|---|
| **Option 1 ✅** | OSS unlimited (with caveats) + Cloud Free (10/mo) + Cloud Paid | **Chosen** — widest funnel, clearest upgrade path |
| Option 2 | OSS capped (100 fixes/mo) + Cloud Paid | Rejected — alienates power users who self-host |
| Option 3 | OSS unlimited, no cloud free tier, Cloud Paid only | Rejected — misses free-trial conversions |

### The Three Paths

```
                    ┌──────────────────────────────────┐
                    │      DISCOVER STAS               │
                    │  GitHub / HN / Reddit / Word of   │
                    │  mouth                            │
                    └──────────┬───────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Self-Host (OSS) │ │Cloud Free    │ │Cloud Paid    │
    │                 │ │(10 fixes/mo) │ │($49-$149/mo) │
    │ Unlimited fixes │ │Our AGI       │ │Our AGI       │
    │ Your API key    │ │No infra      │ │Full dashboard│
    │ Manual setup    │ │Limited       │ │Analytics     │
    │ No dashboard    │ │dashboard     │ │Audit log     │
    │ Community       │ │Community     │ │SLA support   │
    │ support         │ │support       │ │              │
    └────────┬────────┘ └──────┬───────┘ └──────┬───────┘
             │                │                  │
             ▼                ▼                  ▼
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
- Our AGI model (50% better than GPT-5.5)
- One-click install (GitHub App)
- Limited analytics view
- Community support
- **Entry point** — proves value before paid conversion

### Solo ($49/mo)
- 100 fixes/month included
- Our AGI model routing
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
- Custom model routing (bring your own model or use ours)
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
| **STAS** | **✅ Self-host unlimited + Cloud 10/mo** | **$49/mo** | **$149/mo** | **Best value — our AGI** |

STAS is the **only option** with both a free self-host (unlimited) and a free cloud tier. Competitors force you to choose: either self-host everything (KintsugiBot) or pay from day one (Plip, TaskBounty).

---

## Agent Economics

From XOR benchmark (real API costs, not estimates):

| Agent | $/pass | Pass rate | Fix cost |
|---|---|---|---|
| Claude Opus 4.5 (direct API) | $2.64 | 45.7% | $2.64 |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% | $8.29 |
| OpenCode + Opus 4.6 | $51.88 | 47.5% | $109.22 |
| **STAS (our AGI, projected)** | **$3.00** | **90%+** | **$3.33** |

Our AGI efficiency: 50% better pass rate than GPT-5.5 at roughly half the cost. At scale, we project $3-4 per successful fix vs $5-8 for GPT-5.5 and $52+ for OpenCode + Opus.

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
                    │  stas.dev           │
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
    │ BYO API keys │  │ Our AGI      │  │              │
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
- Post on Hacker News: "I built a bot that fixes GitHub issues with our AGI"
- Reddit r/programming, r/MachineLearning
- Built-in spread: every PR says "Fixed by STAS" at the bottom
- DevRel: written guides, architecture breakdowns

### Phase 2 — Organic growth
- Open-source installs drive awareness
- Word of mouth from "it fixed my bug overnight"
- Hacker News launch when OSS hits 500+ stars
- Benchmark comparisons showing our AGI dominance
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
- **Gross margin**: 70%+ (our AGI inference cost + infra)
- **Self-host cost to us**: $0 (user pays for their own infra + API keys)
- **Cloud Free cost to us**: ~$30/mo per 100 active users (AGI inference on 10 fixes/user)
- **Solo margin**: Negative on heavy users ($350 cost vs $49 revenue)
- **Team margin**: Near break-even ($1,750 cost vs $149 revenue)
- **Enterprise margin**: Profitable (volume pricing on inference)

Standard SaaS unit economics — subsidize acquisition with Free/Solo, monetize on Team/Enterprise.

---

## Defensibility

| Threat | Defense |
|---|---|
| Competitors get better models | Our AGI is 50% better than anything public. Model gap is widening, not closing. |
| GitHub builds this natively | They own the platform. But they build for everyone; we build for AGI quality. |
| OpenCode alternative | People can just use opencode CLI directly. But STAS adds the trigger, sandbox, status UI, PR pipeline. |
| Price war | Our margins are better (cheaper model). We can win on price. |
| Copycats | Code is OSS. The moat is the model, not the connector code. |
| Self-host users never convert | Option 1 addresses this: no dashboard, no audit log, community-only support are real pain points at scale. |

---

## Costs (Hosted)

| Item | Cost | Note |
|---|---|---|
| AGI inference | ~$3/fix | Our model, our infra |
| Sandbox compute | ~$0.50/fix | E2B or similar |
| Hosting + infra | ~$200/mo | Baseline |
| 100 fixes on Solo plan | ~$350 cost | $49 revenue → negative margin on Solo |
| 500 fixes on Team plan | ~$1,750 cost | $149 revenue → needs volume pricing on inference |

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
