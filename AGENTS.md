# STAS — Solving Tickets As A Service

## One-liner

Label a GitHub issue. Our AGI investigates, fixes, and opens a PR. You review and merge.

## What this project is

An open-source GitHub bot that turns labeled issues into pull requests. Backed by OpenCode's agent harness. The hosted tier routes through our proprietary AGI (50% better than GPT-5.5 on DeepSWE).

### Key insight

Every competitor (Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin) wraps Claude/GPT. None has a better model. Our moat is **superior AGI quality at lower cost**.

## Architecture

```
GitHub Issue (labeled "stas:fix")
       │
       ▼
  Webhook Server (Express, ~260 LOC)
       │
       ├── Verify webhook signature
       ├── Post "working on it" comment
       ├── Build prompt from issue context
       │
       ▼
  OpenCode Serve (:4096)
       │
       ├── Clone repo (shallow)
       ├── Investigate root cause
       ├── Write fix + regression test
       ├── Run existing test suite
       ├── Commit & push branch
       │
       ▼
  GitHub API
       │
       ├── Open draft PR
       └── Post result comment
```

## Business model (open-core)

| OSS (free) | Paid SaaS ($49/mo) |
|---|---|
| Self-host the bot | We host it |
| Uses your API key + your model | Uses our AGI (50% better) |
| Single repo, manual setup | One-click install, all repos |
| No dashboard | Dashboard, analytics, audit log |
| You manage infra | Zero ops |
| Community support | SLA, SSO, priority |

**Funnel**: Self-host (free) → hit limits/discover quality → upgrade to hosted ($49/mo)

## Competitive landscape

| Competitor | Model | OSS | Self-host | Cost/fix | Notes |
|---|---|---|---|---|---|
| Plip.io | Claude | ❌ | ❌ | $2-5+ | Free tier 10/mo, SaaS only |
| TaskBounty | Multi-agent | ❌ | ❌ | $2-52 | Marketplace + subscription |
| KintsugiBot | Any LLM | ✅ | ✅ | BYO API | Newest OSS entrant |
| Open SWE | Claude/GPT | ✅ | ✅ | BYO API | LangChain, 10K stars |
| SWE-agent | Any LLM | ✅ | ✅ | BYO API | Princeton, 19K stars, NeurIPS |
| OpenRonin | Claude/GPT | ✅ | ✅ | BYO API | Full lifecycle agent |
| **STAS (OSS)** | **Our AGI** | **✅** | **✅** | **Minimal** | **OpenCode native** |

## Agent economics (real data from XOR benchmark)

| Agent | Cost/fix | Pass rate |
|---|---|---|
| Claude Opus 4.5 (direct) | $2.64 | 45.7% |
| GPT-5.2 Codex | $5.30 | 62.7% |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% |
| OpenCode + Opus 4.6 | $51.88 | 47.5% |

Our AGI outperforms GPT-5.5 by 50%. At $5.80/fix for 70% pass, we project ~$3-4/fix for 90%+ pass. That's 3x better value.

## Key design decisions

1. **Label trigger** (`stas:fix`) — zero config, familiar from Plip
2. **2-phase triage** — cheap model classifies/scopes → expensive model fixes
3. **Verification gate** — must pass existing tests + new regression test
4. **Sandbox isolation** — Docker (local) → E2B (production)
5. **Real-time status** — agent posts progress as issue comments

## Status

**Phase 1 (core loop)**: ✅ Done — webhook receiver, OpenCode dispatch, PR creation
**Phase 2 (hardening)**: 🔜 Next — triage, sandbox, verification, error handling
**Phase 3 (OSS launch)**: 🔜 — setup guides, one-command deploy, launch
**Phase 4 (hosted)**: 🔜 — cloud deployment, dashboard, Stripe, $49/mo

## Links

- GitHub: https://github.com/tamnguyen08/solving_tickets_as_a_service
- Linear: https://linear.app/aimino/project/stas-solving-tickets-as-a-service-83140efb3366
- Master ticket: https://linear.app/aimino/issue/AIM-1185/build-stas-mvp-open-source-github-bot-that-turns-labeled-issues-into
