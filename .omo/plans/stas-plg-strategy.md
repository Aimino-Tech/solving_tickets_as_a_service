# STAS Product-Led Growth Strategy

Generated: 2026-06-25 | Status: Plan (Updated with Cross-Critique)
Team: competition-analyst, ux-designer, growth-strategist, adversarial-critic
Cross-critique: 2 agents — 12 findings incorporated

---

## ⚠️ Critical Warnings from Cross-Critique

Before executing any part of this plan, these must be resolved:

### C1: Pricing Alignment (BLOCKING)
Three contradictory pricing schemes exist: Output A ($49), Output B ($39/$99), Actual code ($49/$149). STRATEGY.md admits -$301/Solo customer loss at full usage. **Must align pricing and fix unit economics before paid launch.**

### C2: Business Model (BLOCKING)
Docs sell OSS self-host (unlimited, BYO API), but code implements SaaS free tier (10 fixes/mo). These are opposite models — free tier cannibalizes conversion. **Must choose: SaaS-gated or OSS-unlimited, not both.**

### C3: "Our AGI" Moats Don't Exist
Default model is `claude-sonnet-4-20250514`. No proprietary model exists. All competitive claims assuming superior AGI are projections. **Position as "turnkey OpenCode deployment" until model ships.**

### C4: No MCP Server Exists
Agent-first growth loop requires MCP server. Zero MCP code. **Implement MCP server before claiming agent-first strategy.**

---

## 1. Core Thesis

STAS is a **SaaS** GitHub bot that turns labeled issues into PRs. Target users are **developers** first (viral PR footer → human curiosity → signup), **AI agents** second (future MCP auto-discovery).

The PLG flywheel: Developer labels issue → STAS fixes silently → PR appears → PR footer has link → other devs discover → install → more labels.

## 2. Competitive Position

### 9-Competitor Matrix
| Competitor | Pricing | Model | Weakness | STAS Exploit |
|---|---|---|---|---|
| Plip.io | $39-599/mo flat | Claude-only, SaaS | Locked to one model, unproven | Superior AGI, better quality |
| TaskBounty | $49-145/mo per-seat | Verification-gated | Per-seat kills adoption | Flat-rate $49/mo |
| Open SWE | Free (BYO API) | OSS, LangChain | Fake OSS, low quality | Real AGI, turnkey |
| SWE-agent | Free (BYO API) | Princeton Research | Research only, not prod | Production-ready |
| KintsugiBot | Free/$5/mo | OSS, Self-host | Hobby project | Enterprise-grade |
| Devin | $20-500/mo + ACU | Opaque pricing | Sentiment 52/100 | Transparent flat-rate |
| Cursor | $20-200/mo per-user | IDE-embedded | Trust 63/100, per-seat | Repo-level, not per-seat |
| GitHub Copilot | $10-39/mo per-user | IDE plugin | Quality complaints, per-seat | 50-person team: $49 vs $950/mo |

### Killer Advantage
**$49/mo flat-rate vs per-seat pricing across the industry.** Per-seat pricing on all competitors is the weakness STAS exploits hardest.

Note: Copilot comparison is category mismatch (IDE autocomplete vs PR bot). Use sparingly — implies STAS competes with Copilot when it's actually complementary.

## 3. Product-Led Growth UX

### Shortest Path (3 clicks to value)
1. **Install** → GitHub OAuth (2s)
2. **Label** an issue `stas:fix` (1s)
3. **PR appears** — bot works silently, no comments, just the PR

No config, no demo call, no approval flow. Zero setup required.

### Silent Processing (from critique: progress comments are noise)
- **No progress comments** during execution. The bot works invisibly.
- **Only notification**: the draft PR appearing in the repo.
- **Fallback for slow jobs** (>5 min): one post at T+5min: "Still working on this complex issue."
- **PR body** includes: root cause explanation, why the fix is safe, test strategy

### Viral PR Footer
Every PR footer: `🛠 Fixed by [STAS](https://stas.dev?ref=pr-footer)` — UTM-tracked link to shareable run page.

### Shareable Run Page (primary viral channel, from critique)
`https://stas.dev/runs/{runId}` — public page showing:
- Before/after diff
- Root cause summary
- Test results
- Badge: `[![Fixed by STAS](https://stas.dev/badge.svg)](...)`

For private repos: expiring share links (24h) a la Linear.

### Self-Serve SaaS Onboarding
- GitHub OAuth only (no signup form)
- No welcome modal, no checklist
- Empty state: "Label an issue with `stas:fix` to get started"
- No demo PR (from critique: unsolicited PRs break trust)

## 4. Growth Flywheel

```
GitHub Marketplace → Install STAS → Label issue → PR appears (wow)
                                                           ↓
                                                  PR footer "Fixed by STAS"
                                                           ↓
                                              Other devs discover via link
                                                           ↓
                                                  Install on more repos
```

### Loops
1. **Top loop**: GitHub Marketplace → Install → First PR (wow)
2. **Viral loop**: PR footer + shareable run page → new devs discover
3. **Conversion loop**: Free tier (10 fixes/mo) → hit limit → upgrade

## 5. Pricing (FROM ACTUAL CODE — $49/$149)

| Tier | Price | Fixes/mo | Repos | Support | SLA |
|---|---|---|---|---|---|
| Free | $0 | 10 | 1 | Community | None |
| Solo | $49/mo | 100 | 5 | Email | Best-effort |
| Team | $149/mo | 500 | Unlimited | Priority | 4hr response |
| Enterprise | Custom | Unlimited | Unlimited | Dedicated | 1hr SLA |

**⚠️ Unit economics warning**: Each Solo fix costs ~$3.50 in inference = $350 for 100 fixes vs $49 revenue. Strategy must reduce inference cost or this model loses money.

## 6. 90-Day KPI Targets

| Metric | Q1 (Launch) | Q2 | Q3 |
|---|---|---|---|
| Active repos | 500 | 2,000 | 5,000 |
| Fix completion rate | 60% | 70% | 75% |
| Free → Paid conversion | 5% | 10% | 15% |
| Viral coefficient (k) | 0.15 | 0.25 | 0.35 |

## 7. Attack Vectors & Mitigations

| Attack | Evidence | Mitigation | Status |
|---|---|---|---|
| AV1: Code leaves VPC | "I don't trust sending code to random SaaS" | SOC2 cert, data retention policy, encryption | **Not implemented** — requires ticket |
| AV2: AI introduces vulns | "40% of AI patches introduce new vulnerabilities" | SAST pipeline (semgrep/CodeQL) + multi-verification | **Not implemented** — new ticket |
| AV3: Cost too high | "$15-25/PR to review AI code" | Free tier shows value; transparent flat-rate | Mitigated via pricing |
| AV4: Noise, ignored | "Bot is noisy by week three" | **Silent processing** — no progress comments | **Change from original design** |
| AV5: Verification debt | "Reviewing AI code is harder than writing" | Evidence in PR body; self-audit gate | In backlog (AIM-1957) |
| AV6: IP/training data | "Am I training my competitor's model?" | "Won't Train" guarantee, DPA in signup | **Not implemented** — new ticket |

## 8. Channel Strategy

1. **GitHub Marketplace** (primary) — listed as "Auto-fix labeled issues"
2. **Product Hunt** launch — target: #1 Product of Day
3. **Hacker News** — "Show HN: I built a GitHub bot that fixes your issues"
4. **Developer newsletters** — TLDR, Python Weekly, Node Weekly
5. **Technical blog** — "How we fixed 10,000 issues with AI" — real metrics
6. **Comparison pages** — "STAS vs Plip", "STAS vs Devin"

## 9. OpenClaw Multi-Channel Layer (from §8.5)

### Agent Access (MCP)
- **STAS MCP Server** — agents auto-discover via MCP protocol
- **Note**: MCP server does not exist yet. See AIM-2072.

### Human Access (via OpenClaw)
- **Slack**: `/stas fix "login button not working"` → creates issue, runs fix, posts PR link
- **Telegram**: Same commands via bot
- **WhatsApp**: Same commands via business API
- **Status queries**: `/stas status #42` → "Fix complete — PR #42 is ready"

## 10. Ticket Generation

| Ticket | Area | P | Rationale |
|---|---|---|---|
| AIM-2071 | Agent-First Architecture | P1 | Architectural binding — all components expose MCP/REST |
| AIM-2072 | MCP Server | P1 | Required for agent-first; zero MCP code exists |
| AIM-2073 | Viral PR Footer + Run Page | P2 | Primary viral channel |
| AIM-2075 | One-Click GitHub OAuth | P1 | Dead-simple signup — no config |
| AIM-2077 | Free Tier PQL | P1 | 10 fixes free — convert at limit |
| AIM-2078 | Pricing/Positioning Pages | P2 | Attack per-seat weakness |
| AIM-2079 | Data Privacy Guarantee | P1 | "Won't Train" + DPA — answers AV6 |
| AIM-2081 | OpenClaw Integration | P1 | Multi-channel access |
| **NEW** | Pricing Alignment + Unit Economics | **P0** | Resolve $39/$49/$149 contradiction before launch |
| **NEW** | SAST Pipeline (semgrep/CodeQL) | P1 | AV2 mitigation for enterprise trust |
| **NEW** | Silent Processing (delete progress comments) | P1 | Critique finding #1 — progress is noise |
| **NEW** | Enterprise Tier (SSO/SAML) | P2 | Required for enterprise revenue |
| **NEW** | SOC2 Readiness | P2 | Required for enterprise trust (AV1) |

## 11. Synthesis Notes

- **Primary insight**: STAS wins on flat-rate pricing vs per-seat (Copilot, Cursor, Devin).
- **Silent processing**: No progress comments — just PR appears. This is the critique's strongest finding.
- **Trust is the biggest blocker**: 6 attack vectors from Reddit/HN all boil down to trust. SOC2, SAST pipeline, and data privacy docs are prerequisites for enterprise.
- **Fix unit economics before paid launch**: At $3.50/fix inference cost, every paying customer who fully uses their allocation loses money.
