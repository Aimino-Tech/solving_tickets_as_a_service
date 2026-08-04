# SYNTARO Product-Led Growth Strategy

Generated: 2026-07-17 | Status: Plan (Pricing Alignment Complete)
Team: competition-analyst, ux-designer, growth-strategist, adversarial-critic

---

## ✅ Critical Warnings — All Resolved

### C1: Pricing Alignment ✅ RESOLVED
**Canonical pricing established: $49/mo Solo, $149/mo Team.**
- All docs, code, and config aligned to $49/$149
- Dashboard Pricing.tsx fixed ($39→$49, $99→$149, fix limits corrected)
- Backend pricing routes consistent (was already $49/$149)
- STRATEGY.md updated to match
- See docs/UNIT_ECONOMICS.md for breakeven analysis

### C2: Business Model ✅ RESOLVED
**Option 1 confirmed: OSS unlimited + Cloud Free (10 fixes/mo, hard stop) + Cloud Paid**
- Self-host unlimited with caveats (no dashboard, community support)
- Cloud Free capped at 10 fixes/month — hard stop via metering
- Both paths point to Solo/Team/Enterprise for full features

### C3: "Our AGI" Claims ✅ REMOVED
**All references to "Our AGI" removed from codebase.**
- Default model is `claude-sonnet-4-20250514` (from config: `OPENCODE_MODEL`)
- All competitive claims updated to "Powered by OpenCode + frontier models"
- Benchmark data updated to reference actual model names
- STRATEGY.md moat section rewritten to focus on pipeline quality, not model exclusivity

### C4: MCP Server ✅ ACKNOWLEDGED
MCP server remains unimplemented. Tracked separately (AIM-2072). Not blocking pricing alignment.

---

## 1. Core Thesis

SYNTARO is a **SaaS** GitHub bot that turns labeled issues into PRs. Target users are **developers** first (viral PR footer → human curiosity → signup), **AI agents** second (future MCP auto-discovery).

The PLG flywheel: Developer labels issue → SYNTARO fixes silently → PR appears → PR footer has link → other devs discover → install → more labels.

## 2. Competitive Position

### 9-Competitor Matrix
| Competitor | Pricing | Model | Weakness | SYNTARO Exploit |
|---|---|---|---|---|
| Plip.io | $39-599/mo flat | Claude-only, SaaS | Locked to one model, unproven | Better pipeline quality, open source |
| TaskBounty | $49-145/mo per-seat | Verification-gated | Per-seat kills adoption | Flat-rate $49/mo |
| Open SWE | Free (BYO API) | OSS, LangChain | Fake OSS, low quality | Production-ready, turnkey |
| SWE-agent | Free (BYO API) | Princeton Research | Research only, not prod | Production-ready |
| KintsugiBot | Free/$5/mo | OSS, Self-host | Hobby project | Enterprise-grade |
| Devin | $20-500/mo + ACU | Opaque pricing | Sentiment 52/100 | Transparent flat-rate |
| Cursor | $20-200/mo per-user | IDE-embedded | Trust 63/100, per-seat | Repo-level, not per-seat |
| GitHub Copilot | $10-39/mo per-user | IDE plugin | Quality complaints, per-seat | 50-person team: $49 vs $950/mo |

### Killer Advantage
**$49/mo flat-rate vs per-seat pricing across the industry.** Per-seat pricing on all competitors is the weakness SYNTARO exploits hardest.

## 3. Product-Led Growth UX

### Shortest Path (3 clicks to value)
1. **Install** → GitHub OAuth (2s)
2. **Label** an issue `syntaro:fix` (1s)
3. **PR appears** — bot works silently, no comments, just the PR

No config, no demo call, no approval flow. Zero setup required.

### Silent Processing
- **No progress comments** during execution. The bot works invisibly.
- **Only notification**: the draft PR appearing in the repo.
- **Fallback for slow jobs** (>5 min): one post at T+5min: "Still working on this complex issue."
- **PR body** includes: root cause explanation, why the fix is safe, test strategy

### Viral PR Footer
Every PR footer: `🛠 Fixed by [SYNTARO](https://syntaro.dev?ref=pr-footer)` — UTM-tracked link to shareable run page.

### Shareable Run Page (primary viral channel)
`https://syntaro.dev/runs/{runId}` — public page showing:
- Before/after diff
- Root cause summary
- Test results
- Badge: `[![Fixed by SYNTARO](https://syntaro.dev/badge.svg)](...)`

For private repos: expiring share links (24h) a la Linear.

### Self-Serve SaaS Onboarding
- GitHub OAuth only (no signup form)
- No welcome modal, no checklist
- Empty state: "Label an issue with `syntaro:fix` to get started"
- No demo PR

## 4. Growth Flywheel

```
GitHub Marketplace → Install SYNTARO → Label issue → PR appears (wow)
                                                           ↓
                                                  PR footer "Fixed by SYNTARO"
                                                           ↓
                                              Other devs discover via link
                                                           ↓
                                                  Install on more repos
```

### Loops
1. **Top loop**: GitHub Marketplace → Install → First PR (wow)
2. **Viral loop**: PR footer + shareable run page → new devs discover
3. **Conversion loop**: Free tier (10 fixes/mo, hard stop) → hit limit → upgrade

## 5. Pricing (Canonical — $49/$149)

| Tier | Price | Fixes/mo | Model | Support |
|---|---|---|---|---|
| Free | $0 | 10 (hard stop) | Basic | Community |
| Solo | $49/mo | 100 | claude-sonnet-4 | Email, best-effort |
| Team | $149/mo | 500 | claude-sonnet-4 | Priority, 4hr SLA |
| Enterprise | Custom | Unlimited | Custom | Dedicated, 1hr SLA |

**⚠️ Unit economics**: Each fix costs ~$3.50 in inference + sandbox. At full utilization, Solo loses $300+/customer. Cost optimization plan targets $1.70/fix. See docs/COST_OPTIMIZATION.md and docs/UNIT_ECONOMICS.md.

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
| AV1: Code leaves VPC | "I don't trust sending code to random SaaS" | SOC2 cert, data retention policy, encryption | **Not implemented** |
| AV2: AI introduces vulns | "40% of AI patches introduce new vulnerabilities" | SAST pipeline (semgrep/CodeQL) + multi-verification | **Not implemented** |
| AV3: Cost too high | "$15-25/PR to review AI code" | Free tier shows value; transparent flat-rate | Mitigated via pricing |
| AV4: Noise, ignored | "Bot is noisy by week three" | **Silent processing** — no progress comments | **Implemented** |
| AV5: Verification debt | "Reviewing AI code is harder than writing" | Evidence in PR body; self-audit gate | In backlog (AIM-1957) |
| AV6: IP/training data | "Am I training my competitor's model?" | "Won't Train" guarantee, DPA in signup | **Not implemented** |

## 8. Channel Strategy

1. **GitHub Marketplace** (primary) — listed as "Auto-fix labeled issues"
2. **Product Hunt** launch — target: #1 Product of Day
3. **Hacker News** — "Show HN: I built a GitHub bot that fixes your issues"
4. **Developer newsletters** — TLDR, Python Weekly, Node Weekly
5. **Technical blog** — "How we fixed 10,000 issues with AI" — real metrics
6. **Comparison pages** — "SYNTARO vs Plip", "SYNTARO vs Devin"

## 9. Multi-Channel Layer

### Agent Access (MCP)
- **SYNTARO MCP Server** — agents auto-discover via MCP protocol
- **Note**: MCP server does not exist yet. See AIM-2072.

### Human Access
- **Slack**: `/syntaro fix "login button not working"` → creates issue, runs fix, posts PR link
- **Telegram**: Same commands via bot
- **WhatsApp**: Same commands via business API
- **Status queries**: `/syntaro status #42` → "Fix complete — PR #42 is ready"

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
| AIM-3209 | **Pricing Alignment + Unit Economics** | **P0** | ✅ **COMPLETE** — $49/$149 aligned, AGI claims removed, docs created |
| **NEW** | SAST Pipeline (semgrep/CodeQL) | P1 | AV2 mitigation for enterprise trust |
| **NEW** | Silent Processing (delete progress comments) | P1 | Critique finding #1 — progress is noise |
| **NEW** | Enterprise Tier (SSO/SAML) | P2 | Required for enterprise revenue |
| **NEW** | SOC2 Readiness | P2 | Required for enterprise trust (AV1) |

## 11. Synthesis Notes

- **Primary insight**: SYNTARO wins on flat-rate pricing vs per-seat (Copilot, Cursor, Devin).
- **Pricing aligned**: $49/$149 canonical across all docs, code, and config.
- **No more AGI claims**: Positioned as "Powered by OpenCode + frontier models" until proprietary model ships.
- **Unit economics documented**: Breakeven analysis in docs/UNIT_ECONOMICS.md, cost optimization plan in docs/COST_OPTIMIZATION.md.
- **Silent processing**: No progress comments — just PR appears.
- **Trust is the biggest blocker**: SOC2, SAST pipeline, and data privacy docs are prerequisites for enterprise.
- **Fix unit economics before paid launch**: Cost optimization path targets $1.70/fix to achieve healthy margins.
