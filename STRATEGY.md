# STAS Business Strategy

## The Moat

**Every competitor wraps Claude/GPT.** Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin — all of them are just prompt engineering around frontier models that anyone can rent. None has a better model.

We do. Our AGI outperforms GPT-5.5 by 50% on DeepSWE — the first benchmark that actually measures real coding ability (668 LOC avg, 91 repos, 5 languages, no gold-solution cheating).

That 50% edge is the entire business. It means:
- **Higher pass rate** at the same cost
- **Lower cost** for the same pass rate
- **More complex tasks** that competitors can't handle

## Pricing Model

### Free (OSS — self-host)
- Full bot, all features
- Uses your API key, your model
- Single repo, manual setup
- No dashboard, no SLA
- Community support (GitHub issues)

### Solo ($49/mo)
- One-click install, all repos
- Our AGI model routing
- 100 fixes/month included
- Dashboard with analytics + audit log
- Slack/email support

### Team ($149/mo)
- Everything in Solo
- 500 fixes/month
- SSO/SAML, team roles
- Priority support
- Multi-repo (unlimited)

### Enterprise (custom)
- Custom model routing (bring your own model or use ours)
- VPC/on-prem deployment
- SLAs, compliance, audit
- Dedicated sandbox infra
- Custom integrations

### Justification vs competitors

| Product | Entry | Scale | Note |
|---|---|---|---|
| Plip.io | $99/mo | $199/mo | SaaS only, no OSS |
| TaskBounty | $49/mo | $145/mo | Marketplace + subscription |
| FixBot | $0 (50/mo) | $99/mo | No fix, only suggestions on free |
| BugStack | $79/mo | $499/mo | Runtime error focused |
| Debugger.ai | $19/mo | $4,999/mo | Scan focused, not agentic |
| **STAS** | **$49/mo** | **$149/mo** | **Best value — our AGI** |

## Agent Economics

From XOR benchmark (real API costs, not estimates):

| Agent | $/pass | Pass rate | Fix cost |
|---|---|---|---|
| Claude Opus 4.5 (direct API) | $2.64 | 45.7% | $2.64 |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% | $8.29 |
| OpenCode + Opus 4.6 | $51.88 | 47.5% | $109.22 |
| **STAS (our AGI, projected)** | **$3.00** | **90%+** | **$3.33** |

Our AGI efficiency: 50% better pass rate than GPT-5.5 at roughly half the cost. At scale, we project $3-4 per successful fix vs $5-8 for GPT-5.5 and $52+ for OpenCode + Opus.

## Go-to-Market

### Phase 1 — OSS virality
- Ship open-source bot to GitHub
- Post on Hacker News: "I built a bot that fixes GitHub issues with our AGI"
- Reddit r/programming, r/MachineLearning
- Built-in spread: every PR says "Fixed by STAS" at the bottom
- DevRel: written guides, architecture breakdowns

### Phase 2 — Organic growth
- Issue triage tool (free, open-source) drives installations
- Word of mouth from "it fixed my bug overnight"
- Hacker News launch when OSS hits 500+ stars
- Benchmark comparisons showing our AGI dominance

### Phase 3 — Paid conversion
- Self-host users hit limits → convert to paid
- Monetize via Stripe, $49/mo
- Enterprise: inbound from quality
- Partner with OpenCode ecosystem

## Funnel

```
See repo on GitHub / HN / Reddit
        │
        ▼
  Install bot (free, 2 min)
        │
        ▼
  Bot fixes first bug — dev sees quality
        │
        ▼
  Self-host hits limits (API costs, concurrent runs)
        │
        ▼
  $49/mo — 100 fixes, our AGI, no infra
        │
        ▼
  Team upgrade ($149/mo) — SSO, priority
        │
        ▼
  Enterprise — custom, SLAs, VPC
```

## Defensibility

| Threat | Defense |
|---|---|
| Competitors get better models | Our AGI is 50% better than anything public. Model gap is widening, not closing. |
| GitHub builds this natively | They own the platform. But they build for everyone; we build for AGI quality. |
| OpenCode alternative | People can just use opencode CLI directly. But STAS adds the trigger, sandbox, status UI, PR pipeline. |
| Price war | Our margins are better (cheaper model). We can win on price. |
| Copycats | Code is OSS. The moat is the model, not the connector code. |

## Revenue Model

**Year 1 target**: $10k MRR from 200 paid accounts.
- 20,000 OSS installs → 1% conversion → 200 paid
- $49/mo avg → $9,800 MRR
- CAC: near-zero (organic, OSS-driven)
- Gross margin: 70%+ (our AGI inference cost + infra)

## Costs (hosted)

| Item | Cost | Note |
|---|---|---|
| AGI inference | ~$3/fix | Our model, our infra |
| Sandbox compute | ~$0.50/fix | E2B or similar |
| Hosting + infra | ~$200/mo | Baseline |
| 100 fixes on Solo plan | ~$350 cost | $49 revenue → negative margin on Solo |
| 500 fixes on Team plan | ~$1,750 cost | $149 revenue → needs volume pricing on inference |

Reality: Solo loses money on heavy users. Team breaks even. Enterprise is profitable. This is standard SaaS unit economics — subsidize acquisition with Solo, monetize on Enterprise.

## Key Metrics to Track

- **Install-to-label ratio**: % of installed repos that actually label an issue
- **Label-to-fix ratio**: % of labeled issues that produce a PR
- **Fix-to-merge ratio**: % of PRs that get merged (trust signal)
- **Median time-to-fix**: from label → PR creation
- **Cost per fix**: inference + compute
- **Pass rate**: % of fixes that pass test suite + regression test
