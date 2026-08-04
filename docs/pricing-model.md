# SYNTARO Business Model & Pricing

## Open Core + Cloud

SYNTARO follows an **open-core model** with three paths, all pointing to paid plans for full features:

| | Self-Hosted (OSS) | Cloud Free | Cloud Paid |
|---|---|---|---|
| **Fixes/mo** | Unlimited (your API key) | 10 fixes/mo | 100–500+/mo |
| **AI model** | Your API key, your model | Our AGI | Our AGI |
| **Setup** | Manual — you run it | One-click install | One-click install |
| **Infrastructure** | You manage | We manage | We manage |
| **Dashboard** | — | Limited analytics | Full analytics, audit log |
| **Support** | GitHub issues (community) | Community | Slack, email, SLA |
| **Cost** | Your API usage | Free | $49–$199/mo |

## Conversion Funnel

1. **Self-Hosted** → Cloud Paid (when infra ops hurt, dashboard needed)
2. **Cloud Free** → Cloud Paid (when 10 fixes/mo isn't enough)
3. **Cloud Paid** → Enterprise (when team needs SSO, VPC, SLAs)

## Plan Details

### Self-Hosted (OSS) — $0 + your API costs
- Unlimited fixes
- Bring your own model API key
- Bring your own infrastructure
- Community support via GitHub Issues
- No dashboard
- MIT licensed — full source access

### Cloud Free — $0/mo
- 10 fixes per month
- Our AGI model
- Limited analytics dashboard
- Community support
- No credit card required

### Cloud Solo — $49/mo
- 100 fixes per month
- Our AGI + premium model access
- Full analytics dashboard
- Audit log
- Email support (24h response, business hours)
- Recommended for individual developers

### Cloud Team — $149/mo
- 500 fixes per month
- Our AGI + premium model access
- Full analytics dashboard with team view
- Audit log
- Priority support (4h response)
- Custom webhooks
- 10 concurrent fixes

### Enterprise — Custom pricing
- Unlimited fixes
- All features
- SLA with dedicated support
- SSO / SAML
- VPC / dedicated infra
- Custom contract terms

## Economics

| Agent | Cost/fix | Pass rate |
|---|---|---|
| Claude Opus 4.5 (direct) | $2.64 | 45.7% |
| GPT-5.2 Codex | $5.30 | 62.7% |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% |
| OpenCode + Opus 4.6 | $51.88 | 47.5% |
| **SYNTARO (our AGI, projected)** | **~$3.00** | **90%+** |

Our AGI projects ~$3-4/fix at 90%+ pass rate — 3x better value than alternatives.

## Competitive Pricing Comparison

| Product | Entry Price | Fixes Included | Self-Host |
|---|---|---|---|
| SYNTARO | Free (OSS) / $49 (Cloud) | 10–500/mo | Yes (MIT) |
| Plip.io | $39/mo | 25 fixes/mo | No |
| TaskBounty | $2-5/fix | Per-fix pricing | No |
| KintsugiBot | BYO API key | Unlimited | Yes |
| Open SWE | BYO API key | Unlimited | Yes |

## Implementation

### Plans
Plans are defined in `src/billing/plans.ts`. Each plan defines:
- Fix limits, model access, concurrent runs
- Stripe Price IDs (set via environment variables)
- Support tier and trial configuration

### Billing Integration
Billing is handled through Stripe:
- `src/billing/stripe.ts` — Stripe client, Checkout Sessions, portal
- `src/billing/webhook.ts` — Webhook handler for subscription events
- `src/billing/routes.ts` — API routes for billing management

### Usage Tracking
Usage is tracked per account per billing period:
- `src/metering/tracker.ts` — Records each fix run with metadata
- `src/billing/usage.ts` — Checks limits and increments counters
- Tier gates enforce limits and return clear upgrade prompts

### Credits & balances (Supabase Postgres)
Overage credit balances live in `credit_balances` / `credit_transactions` on the same Supabase-hosted Postgres as Auth-linked `users` (see `supabase/migrations/`). The Express API mutates them via `CreditsRepository` (`pg` pool) — not via supabase-js table APIs. Schema DDL for this domain belongs in `supabase/migrations/` only.

### Self-Hosted License
Self-hosted users operate without any billing integration. The system:
- Detects self-hosted mode (no `STRIPE_SECRET_KEY` configured)
- Provides unlimited fixes with no tier enforcement
- Optionally supports a license key for dashboard access
- License keys are verified against a public key
