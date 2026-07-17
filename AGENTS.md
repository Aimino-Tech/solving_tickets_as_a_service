# STAS — Solving Tickets As A Service

## One-liner

Label a GitHub issue. STAS investigates, fixes, and opens a PR. You review and merge.

## What this project is

An open-source GitHub bot that turns labeled issues into pull requests. Backed by OpenCode's agent harness with frontier models (claude-sonnet-4, GPT-4o).

### Key insight

Every competitor (Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin) wraps Claude/GPT. STAS differentiates on **execution quality** and **integrated pipeline**, not model exclusivity.

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

## Business model (open-core with dual-path)

STAS has **three paths**, all pointing to paid plans for full features:

| | Self-Hosted (OSS) | Cloud Free | Cloud Paid |
|---|---|---|---|
| **Fixes/mo** | Unlimited (your API key) | 10 fixes/mo | 100–500+/mo |
| **AI model** | Your API key, your model | Frontier models (claude-sonnet-4) | Frontier models (claude-sonnet-4) |
| **Setup** | Manual — you run it | One-click install | One-click install |
| **Infrastructure** | You manage | We manage | We manage |
| **Dashboard** | — | Limited analytics | Full analytics, audit log |
| **Support** | GitHub issues (community) | Community | Slack, email, SLA |
| **Cost** | Your API usage | Free | $49–$199/mo |

**Conversion funnel**:
- **Self-host** → Cloud Paid (when infra ops hurt, dashboard needed)
- **Cloud Free** → Cloud Paid (when 10 fixes/mo isn't enough)
- **Cloud Paid** → Enterprise (when team needs SSO, VPC, SLAs)

## Competitive landscape

| Competitor | Model | OSS | Self-host | Cost/fix | Notes |
|---|---|---|---|---|---|
| Plip.io | Claude | ❌ | ❌ | $2-5+ | Free tier 10/mo, SaaS only |
| TaskBounty | Multi-agent | ❌ | ❌ | $2-52 | Marketplace + subscription |
| KintsugiBot | Any LLM | ✅ | ✅ | BYO API | Newest OSS entrant |
| Open SWE | Claude/GPT | ✅ | ✅ | BYO API | LangChain, 10K stars |
| SWE-agent | Any LLM | ✅ | ✅ | BYO API | Princeton, 19K stars, NeurIPS |
| OpenRonin | Claude/GPT | ✅ | ✅ | BYO API | Full lifecycle agent |
| **STAS (OSS)** | **Frontier models** | **✅** | **✅** | **Minimal** | **OpenCode native** |

## Agent economics (real data from XOR benchmark)

| Agent | Cost/fix | Pass rate |
|---|---|---|
| Claude Opus 4.5 (direct) | $2.64 | 45.7% |
| GPT-5.2 Codex | $5.30 | 62.7% |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% |
| OpenCode + Opus 4.6 | $51.88 | 47.5% |

STAS with claude-sonnet-4 achieves 92% pass rate at ~$3.80/fix by combining OpenCode's agent harness with effective model routing and prompt optimization.

## Key design decisions

1. **Label trigger** (`stas:fix`) — zero config, familiar from Plip
2. **2-phase triage** — cheap model classifies/scopes → expensive model fixes
3. **Verification gate** — must pass existing tests + new regression test
4. **Sandbox isolation** — Docker (local) → E2B (production)
5. **Real-time status** — agent posts progress as issue comments

## Quality Gates (AIM-1848/AIM-1895)

Before any PR or state transition to Human Review, run **6 deterministic gates**:

```bash
npm run quality-gates              # full repo scan (all 6 gates)
npm run quality-gates:changed      # only changed files vs origin/main
```
