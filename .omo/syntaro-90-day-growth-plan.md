# SYNTARO 90-Day Growth Plan

> **Context**: SaaS-only hosted service. No self-host. Powered by OpenCode + frontier models. Competitors (Plip, KintsugiBot) wrap Claude — our moat is the integrated pipeline.

## Current Status

- **Label → fix → PR** pipeline working
- **Verification gate** passing
- **Sandbox isolation** integrated
- **Multi-platform** (GitHub, GitLab, Bitbucket, Linear, Jira)
- **Billing** integrated (Solo $49/mo, Team $149/mo)
- **Pricing aligned** — canonical $49/$149 (per AIM-3209)

## Pricing

| Tier | Price | Fixes/mo | Repos | Model | Analytics | Support | Upgrade Trigger |
|---|---|---|---|---|---|---|---|
| **Free** | $0 | 10 | 1 | Frontier (base) | No | Community | Hits fix limit → upgrade itch |
| **Solo** | $49/mo | 100 | Unlimited | Frontier (priority) | Basic analytics | Email | Outgrows 100 fixes |
| **Team** | $149/mo | 500 | Unlimited | Frontier (priority) | Team analytics, audit log | Slack + Email | Needs SSO |
| **Enterprise** | Custom | Unlimited | Unlimited | Custom model | Full | Dedicated | Compliance, VPC, SLA |

### Pricing vs Competitors

| Product | Free | Entry | Scale | Cost/Fix |
|---|---|---|---|---|
| **Plip** | 10/mo | $39/mo (25 fixes) | $399/mo (100 fixes) | SYNTARO at $49 gives 100 fixes vs Plip's 100 at $399 |
| **Devin** | ❌ | $500/mo (50 fixes) | $5000+/mo | SYNTARO is 10x cheaper per fix |
| **Copilot** | ❌ | $19/mo | $39/mo/person | Per-seat, not per-fix |
| **KintsugiBot** | 10/mo | $5/mo (100 fixes) | N/A | SYNTARO uses frontier models (claude-sonnet-4), not Claude |
| **SYNTARO** | **10/mo** | **$49/mo (100 fixes)** | **$149/mo (500 fixes)** | **Best value** |

### Upgrade Funnel

| Scenario | Path | Est. Conversion |
|---|---|---|
| Hits 10-fix limit mid-month | Free → Solo ($49) | 40% |
| Wants to add 2nd repo | Free → Solo ($49) | 25% |
| Needs dashboard analytics | Free → Solo ($49) | 15% |
| Outgrows 100 fixes/mo | Solo → Team ($149) | 10% |
| Needs compliance/SLA | Solo/Team → Enterprise | 2% |

### Unit Economics Warning

Each fix costs ~$3.50 in inference (~$3.00) + sandbox (~$0.50). Solo customers at full utilization (100 fixes) cost $353 vs $49 revenue. **Cost optimization is critical — target $1.70/fix.** See docs/COST_OPTIMIZATION.md and docs/UNIT_ECONOMICS.md.
