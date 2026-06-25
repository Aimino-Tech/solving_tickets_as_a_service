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

## Quality Gates (AIM-1848/AIM-1895)

Before any PR or state transition to Human Review, run **6 deterministic gates**:

```bash
npm run quality-gates              # full repo scan (all 6 gates)
npm run quality-gates:changed      # only changed files vs origin/main
```

| Gate | Check | OSS Tool | Kills? |
|------|-------|----------|--------|
| 1 — Reality Check | Every referenced file actually exists | `git ls-files`, `fs.stat` | Yes |
| 2 — Compile Check | `tsc --noEmit` passes | TypeScript compiler | Yes |
| 3 — Test Integrity | Tests have real assertions (no vacuous) | vitest + pattern grep | Yes |
| 4 — Hallucination/Stub | No TODO stubs, placeholders, fake imports | grep, npm registry scan | Yes |
| 5 — Dead Code Check | No orphaned files, no unused exports | knip + ts-prune | Yes |
| 6 — External AI Tool Scan | Hallucinated packages, phantom APIs, AI code security, code quality | ghostcheck + trace-core + anti-hallucination-mcp + vibecop | Warn |

### Individual tool scripts

```bash
npm run knip                  # dead code detection (unused files/exports)
npm run ts-prune              # unused TypeScript exports
npm run ghostcheck            # hallucinated packages + phantom APIs
npm run trace-check           # AI-generated code security scan
npm run anti-hallucination    # symbol registry + hallucination report
npm run vibecop               # AI code quality linter
```

### Installed OSS anti-fake/shortcut tools

| Tool | Version | Detects | Install |
|------|---------|---------|---------|
| [ghostcheck](https://github.com/sagarmk/ghostcheck) | 0.1.0 | Hallucinated packages, phantom APIs, insecure patterns | `pnpm add -D ghostcheck` |
| [trace-core](https://tracecheck.dev) | 0.7.0 | AI-generated code security issues | `pnpm add -D trace-core` |
| [anti-hallucination-mcp](https://github.com/Akunimal/Anti-Hallucination-MCP) | 0.14.0 | Hallucinated symbols, import typos, API routes | `pnpm add -D anti-hallucination-mcp` |
| [vibecop](https://github.com/bhvbhushan/vibecop) | 0.4.3 | AI code quality (ast-grep based linter) | `pnpm add -D vibecop` |
| [knip](https://knip.dev) | 6.20.0 | Unused files, dead exports, orphaned code | `pnpm add -D knip` |
| [ts-prune](https://github.com/nadeesha/ts-prune) | 0.10.3 | Unused TypeScript exports | `pnpm add -D ts-prune` |
| gitleaks (binary) | latest | Secrets/credentials in code | `brew install gitleaks` |

**Zero tolerance**: Any gate failure (1-5) blocks PR creation. Gate 6 is advisory/warning. Max 3 fix attempts before human escalation. The gate evidence artifact is attached to every PR.

## Status

**Phase 1 (core loop)**: ✅ Done — webhook receiver, OpenCode dispatch, PR creation
**Phase 2 (hardening)**: 🔜 Next — triage, sandbox, verification, error handling, quality gates
**Phase 3 (OSS launch)**: 🔜 — setup guides, one-command deploy, launch
**Phase 4 (hosted)**: 🔜 — cloud deployment, dashboard, Stripe, $49/mo

## Links

- GitHub: https://github.com/tamnguyen08/solving_tickets_as_a_service
- Linear: https://linear.app/aimino/project/stas-solving-tickets-as-a-service-83140efb3366
- Master ticket: https://linear.app/aimino/issue/AIM-1185/build-stas-mvp-open-source-github-bot-that-turns-labeled-issues-into
