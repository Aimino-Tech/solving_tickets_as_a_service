# STAS Agent-Native Distribution Plan

> **Strategic document**: How STAS becomes the undisputed best MCP server for any AI agent solving SWE tickets, and what niche makes this defensible.

---

## 1. MCP Ecosystem Analysis

### 1.1 Agent Platforms Supporting MCP

The Model Context Protocol has reached critical mass. Every major AI coding agent now speaks MCP — the question is no longer "if" but "how deeply":

| Platform | MCP Support | Transport | Discovery | Auth | Notes |
|----------|-------------|-----------|-----------|------|-------|
| **Claude Code** | Native (first-class) | stdio, HTTP, WebSocket | `tools/list`, `.mcp.json`, Tool Search | OAuth 2.0, API keys, dynamic headers | No fixed per-server tool cap. Per-subagent tool scoping. Can act as MCP server itself via `claude mcp serve`. |
| **Cursor** | Native | stdio, SSE, Streamable HTTP | `.cursor/mcp.json`, Cursor Marketplace, cursor.directory | OAuth, env vars | APPS capability for interactive UI views (unique). Auto-review mode allows MCP tools to run immediately. |
| **Cline** | Native (origin of MCP-VSCode) | stdio, SSE | Cline MCP Marketplace (curated), GitHub submissions | API keys, env vars | First VSCode extension with MCP. Marketplace has 778+ stars. |
| **OpenHands** | SDK + config | SSE, Streamable HTTP, stdio | `config.toml` `[mcp]` section, OpenHands UI | OAuth, Bearer token, API key headers | Proxy server pattern recommended (supergateway). OAuth flow via FastMCP. |
| **Codex CLI** | Native | stdio, HTTP | `~/.codex/mcp.json` | — | OpenAI's coding agent. MCP support in active development. |
| **Gemini CLI** | Via extensions | stdio | `GEMINI.md`, MCP extensions | — | Google's agent. Supports MCP via extensions. |
| **Devin (CLI)** | Native | stdio, SSE, HTTP | Devin MCP Marketplace (Settings > Connections), custom MCP | OAuth, Bearer, API key | Built-in marketplace + custom MCP support. "Test listing tools" verification. |
| **GitHub Copilot** | Via VS Code MCP | stdio | VS Code MCP settings | PAT | Limited MCP support via VS Code extension mechanism. |
| **Roo Code** | Native (Cline fork) | stdio, SSE | `.roo/rules/*.md`, MCP protocol | Same as Cline | Fork with additional privacy features. |
| **Windsurf** | Native | stdio, SSE | Cascade agent mode | OAuth | Codeium's AI IDE. Agent mode for autonomous sub-tasks. |

**Key takeaway**: MCP support is now table stakes for agent platforms. There is no dominant platform — agents are multi-platform, and MCP servers that work across all of them have the widest reach.

### 1.2 Agent Discovery & Installation Flow

Agents discover MCP servers through four channels:

**Channel 1 — Config file (manual setup)**
- Claude Code: `.mcp.json` (project) or `~/.claude/settings.json` (user)
- Cursor: `.cursor/mcp.json`
- Cline: `cline_mcp_settings.json`
- Codex CLI: `~/.codex/mcp.json`
- Flow: User edits JSON → restarts agent → agent has tools

**Channel 2 — CLI commands**
- Claude Code: `claude mcp add`
- Devin CLI: `devin mcp add`
- OpenHands: `openhands mcp add`
- Flow: User runs CLI command → config updated → agent discovers tools

**Channel 3 — Marketplaces (one-click)**
- Cline MCP Marketplace: Browse → one-click install → Cline auto-clones, configures, and sets up the server
- Devin MCP Marketplace: Browse → click "Enable" → configure → tools available
- Cursor Marketplace: One-click install with OAuth
- Flow: Zero-code install — the marketplace handles config and setup

**Channel 4 — Runtime discovery (emerging)**
- Smithery: `npx @smithery/cli install @aimino/stas-mcp`
- MCP.Directory: Links + install instructions per client
- Flow: Agent fetches tool definitions at runtime, user approves

**Key insight for STAS**: Marketplaces (Channel 3) are the highest-leverage distribution channel. Once listed in Cline Marketplace, Devin Marketplace, or Smithery, STAS becomes discoverable by millions of agents with zero extra effort per user.

### 1.3 MCP Protocol Roadmap

| Milestone | Status | Impact on STAS |
|-----------|--------|----------------|
| MCP 2024-11-05 (initial spec) | Stable | STAS is built on this. JSON-RPC 2.0 over HTTP. |
| Streamable HTTP transport | Stable (2025) | Moving from SSE to Streamable HTTP for lower latency. |
| OAuth 2.0 support | Stable | Enables enterprise SSO flows. |
| Federated registry | In proposal | Analogous to npm — one registry to rule them all. |
| Cryptographic signature layer | In proposal | Similar to sigstore — verified server identity. |
| Tools/Skills | Extending | Distinction between stateless tools and stateful skills. |

**Risk**: Breaking changes to MCP protocol are unlikely — too many major players are invested (Anthropic, OpenAI, Google, Microsoft, Atlassian, Salesforce). The JSON-RPC 2.0 substrate is stable.

**Opportunity**: The federated registry creates a "first-mover advantage" — servers that establish reputation early will be grandfathered into trust rankings.

### 1.4 MCP Marketplaces & Directories

| Marketplace | Servers | Security Audit | Discovery Mechanism | Unique Value |
|-------------|---------|----------------|---------------------|--------------|
| **Smithery** | 3,000+ | None | CLI install (`npx @smithery/cli`) | Largest curated catalog. Easy install. STAS **already listed**. |
| **PulseMCP** | 21,000+ | None | Web search, categories | Largest raw catalog (aggregated from multiple sources). |
| **MCP.Directory** | 2,300+ | None | Web search, one-click install per client | Best client-specific install instructions. |
| **Glama** | 2,000+ | Algorithmic quality scores | GitHub activity scoring | Quality signals (stars, maintenance). |
| **MarketNow** | 8,764 | 6-layer Sentinel pipeline | Security certificates | Only marketplace with security auditing. |
| **MCP.so** | ~1,000+ | None | Tags, categories, search | Community-driven, clean UI. |
| **Cline Marketplace** | ~200+ | Manual review | In-extension browsing | Direct integration with Cline. One-click install. |
| **Devin Marketplace** | ~100+ | Devin-managed | Settings → MCP servers | Integrated with Devin session workflow. |

**STAS current status**: Listed on Smithery (`@aimino/stas-mcp`). Needs listing on Cline Marketplace, Devin Marketplace, MCP.Directory, and PulseMCP.

### 1.5 Most Popular MCP Servers (by install count)

From Smithery's January 2026 telemetry:

1. **Playwright** (browser automation, Microsoft) — the #1 MCP server
2. **Memory** (vector + graph memory, Anthropic reference)
3. **Fetch** (HTML fetch + readability extraction)
4. **Time** (timezone math)
5. **SQLite** (local database for ephemeral agents)
6. **Puppeteer** (browser automation alternative)
7. **Sequential Thinking** (structured reasoning, Anthropic)
8. **Git** (local repo operations)
9. **Atlassian (Jira & Confluence)** — 17.1k installs, official
10. **Context7** (API docs injection) — 48.2k installs

**Enterprise MCP servers** (shipped Oct 2025–Mar 2026): Salesforce, ServiceNow, Workday, Snowflake, Databricks, SAP, Microsoft, HashiCorp, Atlassian.

**Key observation**: No MCP server for automated ticket fixing exists in the top ranks. STAS has a **first-mover opportunity** in a category that doesn't yet exist in the MCP ecosystem.

---

## 2. Competitive MCP Positioning

### 2.1 Gap Analysis: Who Exposes SWE Ticket Fixing via MCP?

| Product | MCP Server Exists | Issue→PR via MCP | Notes |
|---------|-------------------|------------------|-------|
| **Devin** | ✅ Official MCP | ❌ Session management only | Devin MCP (`mcp.devin.ai`) wraps session crud, not ticket fixing. An agent cannot say "fix this bug" and get a PR back. |
| **OpenHands** | ❌ No MCP server | ❌ | OpenHands is an MCP **client**, not server. It consumes MCP tools but doesn't expose its own. |
| **Claude Code** | ✅ Can act as MCP server | ⚠️ Via `claude mcp serve` | Claude Code can expose its agent capabilities as an MCP server, but this is for agent-to-agent delegation, not a packaged issue-fixing service. |
| **Cursor** | ❌ Client only | ❌ | Cursor consumes MCP, doesn't expose it. |
| **Copilot** | ❌ | ❌ | GitHub Copilot Agent (2025) can fix issues, but not via MCP — it's IDE-bound. |
| **Sweep AI** | ❌ | ❌ | Pivoted to JetBrains. No MCP server. |
| **mcp-contributor** | ✅ Community | ⚠️ Auto-contribute via opencode | Experimental, not production-ready. Uses opencode CLI as backend. No enterprise features. |
| **Generic GitHub MCP** | ✅ Multiple | ❌ Git operations only | Servers like mcp-github-api, github-mcp-pro provide PR creation, code review — but NOT investigation, root cause analysis, or verification. They're wrappers around the GitHub API. |
| **STAS** | ✅ Live | ✅ Full pipeline | The **only** MCP server that offers: investigate → diagnose → fix → test → PR in one tool call. |

### 2.2 The Quality Gap

The opportunity isn't just "STAS exists as MCP" — it's **quality of result**. Generic GitHub MCP servers give agents the ability to create PRs, but the agent must:

1. Clone the repo
2. Understand the codebase
3. Diagnose the root cause
4. Write the fix
5. Run tests
6. Create the PR

With STAS, the agent does ONE tool call and gets back a verified PR. The quality gap:

| Dimension | Agent + GitHub MCP only | Agent + STAS MCP |
|-----------|------------------------|------------------|
| Codebase understanding | Agent must clone & explore (tokens, time) | STAS handles investigation (parallelized) |
| Root cause diagnosis | Agent reasoning (variable quality) | STAS 2-phase triage (cheap model scopes, expensive model fixes) |
| Fix quality | Agent-dependent, no verification gate | Multi-phase verification, regression tests required |
| Test execution | Agent must run tests manually | STAS runs suite + new regression tests |
| Multi-platform | GitHub only | GitHub + planned GitLab/Jira/Linear |
| DACH compliance | None | EU data residency, German output (planned) |
| Confidence | No score | Confidence, effort, risk estimates |

### 2.3 Competitive MCP Defensibility Matrix

| Dimension | STAS | Devin MCP | mcp-contributor | GitHub MCPs |
|-----------|------|-----------|-----------------|-------------|
| Issue→PR pipeline | ✅ Complete | ❌ Session mgmt only | ⚠️ Experimental | ❌ Git ops only |
| Multi-platform | 🔲 Planned (GitLab, Jira, Linear) | ✅ GitHub, GitLab, Bitbucket, Linear, Jira | ❌ GitHub only | ⚠️ GitHub only |
| Agent-discoverable tools | ✅ 7 tools (fix, batch, triage, estimate, check, list, get) | ✅ 10+ tools (session CRUD, search, events, schedules) | ✅ 9 tools | ✅ 11-18 tools |
| Self-host option | ✅ Full | ❌ SaaS only | ✅ | ⚠️ Varies |
| Verification gate | ✅ Tests must pass | ❌ | ⚠️ Quality gate (based on syntax, not tests) | ❌ |
| Confidence/risk scoring | ✅ stas_triage, stas_estimate | ❌ | ⚠️ Quality score (0-100) | ❌ |
| Async delegation | ✅ Fire-and-forget with polling | ✅ Session-based | ✅ Pipeline-based | ❌ Synchronous |
| DACH compliance | 🔲 Planned | ❌ | ❌ | ❌ |
| Open source | ✅ MIT | ❌ Proprietary | ✅ | ✅ Varies |

---

## 3. Niche Recommendation

### 3.1 Primary Niche

> **The universal MCP bridge between any AI agent and any issue tracker — a single tool call that investigates, fixes, tests, and opens a PR, discoverable by agents at runtime.**

This is narrower and more defensible than "AI code fixer" or "MCP for GitHub." It specifically owns:

1. **Multi-platform issue intake** — not just GitHub issues, but GitLab, Jira, Linear, and Bitbucket
2. **End-to-end fix pipeline** — from issue URL to merged PR, not just code generation
3. **Agent-discoverable** — tools list, input schemas, and resource templates visible via MCP protocol
4. **Safety guarantees** — verification gates, confidence scores, approval workflows

### 3.2 Niche Defensibility

| Defensibility Factor | Assessment |
|----------------------|------------|
| **Multi-platform coverage** | HIGH — No fix service covers all four (GitHub + GitLab + Jira + Linear). Devin covers GitHub+Jira, but requires Devin subscription. STAS open-source can cover all four. |
| **Pipeline integration** | HIGH — The pipeline (webhook → triage → investigate → fix → test → PR) is STAS's core moat. Competitors would need to rebuild this. |
| **Agent-discovery** | MEDIUM — Once STAS is listed in agent marketplaces, switching costs increase. Agents recommend tools they've used. |
| **Safety & verification** | HIGH — Trust is the #1 barrier to autonomous code fixing. STAS's verification gate, confidence scoring, and approval workflow build institutional trust. |
| **DACH compliance** | HIGH — No competitor offers EU data residency, German output, audit logs, and approval gates. This is a defensible regional moat. |

### 3.3 Niche Intersection

The most defensible niche is the intersection of three vectors:

```
              Multi-platform issue intake
                    (GitHub, GitLab, Jira, Linear)
                           |
                           |
    Agent-discovery ───────┼─────── Safety guarantees
    (tools/list,           |       (verification, confidence,
     runtime discovery)    |        approval gates)
                           |
                           |
                    DACH compliance
                    (EU residency, German output, audit)
```

**Recommendation**: Lead with **"multi-platform issue-to-PR for agents"** as primary niche. Layer **safety/trust** as differentiator. Use **DACH** as geographic beachhead where no competitor has presence.

Do NOT lead with DACH — it narrows the addressable market too much. Lead with multi-platform agent-native fixing, then dominate DACH as the wedge.

### 3.4 Niche Positioning Statement

> **"STAS is the MCP server that turns any issue from any tracker into a verified PR — discovered and called by any AI agent, trusted with production code."**

---

## 4. Distribution Model

### 4.1 Current Model vs Agent-Native Model

| Dimension | Current (GitHub Label/Webhook) | Agent-Native (MCP) |
|-----------|-------------------------------|-------------------|
| **Trigger** | User labels issue `stas:fix` | Agent discovers STAS via `tools/list` and calls `stas_fix_issue` |
| **Setup** | Install GitHub App, add label | Add STAS MCP server config (one-time per agent) |
| **User** | Developer browsing GitHub | AI agent (Claude Code, Cursor, Cline, Codex CLI) |
| **Distribution** | GitHub App Marketplace, word of mouth | Agent marketplaces, MCP directories, smithery |
| **Conversion** | Self-host → Cloud Paid | MCP adoption → need more fixes → Cloud Paid |
| **Virality** | "Fixed by STAS" in PR | Agent recommends STAS in output → more agents use it |
| **Limitation** | Requires human to label the issue | No human in loop — agent calls directly |

### 4.2 Agent Discovery Virality Loop

The MCP distribution model creates a compound virality loop that the webhook model cannot match:

```
Agent calls stas_fix_issue → fix succeeds → PR created
                                          ↓
                              Agent reports success to user
                                          ↓
                         "This issue was fixed by STAS"
                          (appears in PR, agent output)
                                          ↓
                              User (or another agent)
                              discovers STAS via mention
                                          ↓
                              Installs STAS MCP server
                                          ↓
                              Their agents discover STAS
                                          ↓
                              The loop repeats
```

**Key difference from webhook model**: In the webhook model, virality is human-to-human ("I use this GitHub App"). In the agent-native model, virality is **agent-to-agent** — one agent's successful fix output exposes STAS to another agent that reads the PR.

### 4.3 Distribution Channels (Prioritized)

| Channel | Type | Effort | Reach | Priority |
|---------|------|--------|-------|----------|
| **Smithery** | MCP directory | ✅ Already listed | High (3,000+ servers, dominant directory) | Maintain |
| **Cline Marketplace** | Agent marketplace | Medium — submit for review | High (millions of Cline users, one-click install) | **HIGH — Submit now** |
| **MCP.Directory** | MCP directory | Low — add listing | Medium (2,300+ servers, client-specific install) | **HIGH — Submit now** |
| **Devin Marketplace** | Agent marketplace | Medium — submit for review | Medium (growing Devin user base) | **HIGH — Submit now** |
| **PulseMCP** | MCP aggregator | Low — add listing | High (21,000+ servers, largest catalog) | Medium |
| **Cursor Marketplace** | Agent marketplace | Medium — submit | High (dominant AI IDE) | **HIGH — Submit now** |
| **Claude Code recommended list** | Anthropic | Unknown — partnership | Very High (all Claude Code users) | Medium (requires partnership) |
| **MCP.so** | MCP directory | Low — add listing | Low-medium | Low |
| **npm registry** | Package registry | ✅ Already published (`@aimino/stas-mcp`) | Discovery via npm search | Maintain |

### 4.4 Bundled vs On-Demand Distribution

**Bundled distribution** (pre-installed in agent platforms):
- **When**: Agent ships with STAS MCP server pre-configured
- **How**: Partnership with agent platform (e.g., "STAS is one of Cline's recommended MCPs")
- **Pros**: Zero-friction adoption, default choice
- **Cons**: Requires platform partnerships, ongoing maintenance
- **Strategy**: Pursue 1-2 bundled deals (Cline, Cursor marketplaces) for baseline distribution

**On-demand discovery** (agent fetches tools at runtime):
- **When**: Agent calls `tools/list` on Smithery or MCP directory
- **How**: STAS appears in search results, gets installed per-session
- **Pros**: No partnership needed, organic growth
- **Cons**: Higher friction, lost if not discoverable
- **Strategy**: Ensure STAS ranks high in all MCP directories (Smithery, MCP.Directory, PulseMCP)

**Recommendation**: Both paths. 60% effort on marketplace listings (bundled-like), 40% on directory SEO (on-demand).

### 4.5 The MCP Analogue

How did successful MCP servers gain adoption?

| Server | Adoption Path | Analogy for STAS |
|--------|---------------|------------------|
| **Playwright** | Microsoft-maintained, solves a universal need (browser), clear docs | STAS maintains the pipeline, solves a universal dev need (bug fixing) |
| **Atlassian (Jira+Confluence)** | Official enterprise vendor, solves authenticated access | STAS should become the official way agents fix issues, vendor-agnostic |
| **Context7** | Solves a single clear pain point (outdated docs), zero config | STAS solves a single clear pain point (fixing bugs), zero config |
| **Memory** | Anthropic reference, protocol definition | STAS benefits from being the reference MCP for issue fixing |
| **Filesystem** | Universal, works everywhere, zero dependencies | STAS should be the default "fix this" tool for any agent |

**Pattern**: Successful MCP servers solve one problem perfectly, are zero-config to install, and are either vendor-backed or community-viral.

---

## 5. Recommended MCP Surface

### 5.1 Current MCP Surface (Already Live)

STAS already has a mature MCP surface in production at `POST /mcp/jsonrpc`:

**Tools:**
| Tool | Description | Maturity |
|------|-------------|----------|
| `stas_fix_issue` | Dispatch a fix run for a GitHub issue | ✅ Live |
| `stas_check_status` | Check fix run status by runId | ✅ Live |
| `stas_list_runs` | List recent fix runs with optional filters | ✅ Live |
| `stas_get_run` | Full run details by runId | ✅ Live |
| `stas_batch_fix` | Fix multiple issues in one invocation | ✅ Live |
| `stas_triage` | Score which issues in a repo are fixable | ✅ Live |
| `stas_estimate` | Complexity, effort, risk analysis for an issue | ✅ Live |

**Resources:**
| Resource | Description | Maturity |
|----------|-------------|----------|
| `stas://runs/{runId}` | Full run details | ✅ Live |
| `stas://issues/{issueId}` | Issue details with fix status | ✅ Live |
| `stas://issues/{issueId}/context` | Full context bundle for an issue | ✅ Live |
| `stas://repos/{repo}/heuristics` | Repository fix heuristics | ✅ Live |

**Prompts:**
| Prompt | Description | Maturity |
|--------|-------------|----------|
| `stas_fix_pattern` | Template for common fix patterns | ✅ Live |
| `stas_triage_pattern` | Template for triage analysis | ✅ Live |

### 5.2 Minimum Viable MCP Surface (Phase 1 — Now)

The current surface is already **viable for launch**. The MVP for agent adoption:

- `stas_fix_issue` — single issue fix (the core value proposition)
- `stas_check_status` — polling (essential for async workflow)
- `stas_triage` — read-only adoption driver (agents discover triage first, then fix)
- `stas_estimate` — information tool (agents estimate before committing to fix)

**These four tools are sufficient for STAS to be the default choice** for agents needing issue-to-PR capability.

### 5.3 Extended MCP Surface (Phase 2 — 1-3 months)

**New tools to add:**

| Tool | Purpose | Priority |
|------|---------|----------|
| `stas_analyze_pr` | Review an existing PR for quality, risk, and suggestions | High |
| `stas_explain_issue` | Explain an issue in natural language with root cause hypothesis | High |
| `stas_suggest_approaches` | Propose 2-3 fix approaches with trade-offs before committing | Medium |
| `stas_list_supported_platforms` | List which issue platforms STAS supports (GitHub, GitLab, etc.) | Medium |
| `stas_get_capabilities` | Return STAS's full capabilities, limits, and current load | Low |

**Enhanced tool returns** (modify existing tools to return richer data):

| Enhancement | Tool | Value |
|-------------|------|-------|
| Confidence score (0-100) | `stas_fix_issue` response | Agent decides whether to trust the fix |
| Cost estimate ($) | `stas_estimate`, `stas_fix_issue` response | Agent budget-awareness |
| Estimated time | `stas_fix_issue` response | Agent decides async vs sync |
| Alternative approaches | `stas_fix_issue` response | Agent chooses strategy |
| Risk classification | `stas_estimate` | Agent flags high-risk fixes for human review |

### 5.4 Multi-Platform Surface (Phase 3 — 3-6 months)

Current tools assume GitHub issues. Multi-platform support requires:

- **`issueTracker` parameter** on `stas_fix_issue`, `stas_triage`, `stas_estimate` — accepts `github`, `gitlab`, `jira`, `linear`
- **Abstract issue reference** — `{ platform, projectId, issueId }` instead of `{ repoOwner, repoName, issueNumber }`
- **Platform-specific resource URIs** — `stas://github/{owner}/{repo}/issues/{number}`, `stas://gitlab/{projectId}/issues/{iid}`

### 5.5 What Makes STAS the Default Choice

For an agent to choose STAS over alternatives (including doing nothing), the MCP surface must:

1. **Be discoverable** — `tools/list` returns a clear, well-described tool set. Agents read descriptions to decide.
2. **Return actionable data** — Not just "fix submitted", but confidence score, estimated time, cost, and alternatives.
3. **Support async workflow** — Fire-and-forget with polling. Agents don't block.
4. **Provide read-before-write tools** — Triage and estimate let agents decide before committing. This builds trust.
5. **Fail gracefully** — Clear error messages with suggestions. "This issue is out of scope because..." is better than "500 Internal Server Error."

**The minimum surface that achieves "default choice" status:**
- 1 write tool (`stas_fix_issue`)
- 2 read tools (`stas_triage`, `stas_estimate`)
- 1 polling tool (`stas_check_status`)
- Rich return metadata (confidence, cost, time)

**STAS already has all of these.**

---

## 6. Risk Assessment

### 6.1 Risk: Agent Platforms Build Native Fix Capabilities

| Scenario | Likelihood | Impact | Mitigation |
|----------|------------|--------|------------|
| Claude Code improves fix rate to 80%+ | Medium | High | STAS differentiates on multi-platform + verification + DACH |
| Cursor ships built-in issue fixing | Medium | Medium | Cursor is IDE-bound, not async. STAS is platform-agnostic. |
| Copilot Agent matures issue→PR | Medium-High | High | Copilot is GitHub-only. STAS covers GitLab, Jira, Linear. |
| Devin adds MCP fix tools | Medium | Medium | Devin SaaS-only. STAS open-source self-host is differentiator. |

**Strategic response**: Speed to multi-platform + DACH is critical. Once STAS owns the "fix issues from any tracker" position, agent platforms compete with STAS rather than replacing it.

### 6.2 Risk: MCP Fails to Become Standard

| Scenario | Likelihood | Impact | Mitigation |
|----------|------------|--------|------------|
| Anthropic/OpenAI diverge on protocol | Low | High | STAS MCP is JSON-RPC 2.0 over HTTP — transport-agnostic. REST API fallback exists. |
| Agent platforms build proprietary tool APIs | Low | Medium | STAS already has REST API + webhook trigger. MCP is additive, not the only path. |
| MCP adoption plateaus at current level | Low | Medium | Current adoption is already sufficient for distribution. 10+ major platforms support it. |

**Assessment**: MCP failure risk is low. Too many major players are invested. Even if MCP is replaced, the JSON-RPC 2.0 substrate maps trivially to any successor protocol.

### 6.3 Risk: Dependency on Specific Agent Platforms

| Platform Dependency | Risk | Mitigation |
|--------------------|------|------------|
| Claude Code API changes | Medium | Implement against stable MCP spec, not Claude Code extensions |
| Cline marketplace policies | Low | STAS is open-source — no single gatekeeper |
| Smithery directory changes | Low | Diversify across 3+ directories |
| GitHub API rate limiting | Low | STAS can use PAT or GitHub App authentication |

**Strategy**: Support ALL agent platforms equally. Being "the MCP server for Cline" is risky. Being "the MCP server for issue fixing" is not.

### 6.4 Risk: Competitors Claim MCP Space

| Competitor | Timeline | Threat Level | STAS Response |
|-----------|----------|-------------|---------------|
| Devin adds issue-to-PR MCP tools | 2026–2027 | HIGH | Move fast on multi-platform + self-host. Devin is SaaS-only and expensive. |
| OpenHands ships fix-as-service MCP | 2026 | MEDIUM | OpenHands is agent framework, not turnkey fix service. Pipeline quality gap. |
| New startup "MCP-first fix server" | 2026 | MEDIUM | First-mover advantage + OSS community. STAS already has the pipeline, benchmarks, and listings. |
| GitHub Actions-based MCP server | 2026 | MEDIUM | Actions are CI, not agent-native. Different use case. |

**Window of opportunity**: 12–18 months before significant competition emerges in MCP issue-fixing. STAS should establish:
1. MCP ecosystem presence (marketplaces, directories) — 0-3 months
2. Multi-platform support (GitLab, Jira) — 3-6 months
3. DACH compliance features — 6-12 months

### 6.5 Risk Summary

| Risk | Severity | Urgency | Action |
|------|----------|---------|--------|
| Agent platform builds native fix | High | High | Multi-platform + verification moat |
| Competitor MCP fix server emerges | Medium | High | Establish MCP presence NOW |
| MCP protocol fragmentation | Low | Low | REST API fallback |
| Agent marketplace dependency | Low | Medium | List on all marketplaces |
| DACH competitor emerges | Medium | Medium | DACH features + first reference customer |

---

## 7. Recommendations

### 7.1 Strategic Direction

1. **Lead with "multi-platform issue-to-PR for agents"** — this is the widest defensible niche. Every agent on every platform needs to fix issues. STAS is the pipeline that makes it happen.

2. **Submit to all MCP marketplaces immediately** — Cline Marketplace, Devin Marketplace, Cursor Marketplace, MCP.Directory, PulseMCP. Listing is zero-code and compounds over time.

3. **The existing MCP surface is already launch-ready** — 7 tools, 4 resources, 2 prompts. Focus on ecosystem presence, not surface expansion.

4. **Build read-before-write as the adoption funnel** — `stas_triage` and `stas_estimate` are adoption drivers. Agents discover these first, trust the results, then graduate to `stas_fix_issue`.

5. **Rich returns are the differentiator** — confidence scores, cost estimates, and time estimates let agents make intelligent decisions. No other MCP fix server does this.

6. **Multi-platform is the moat** — Adding GitLab, Jira, and Linear support is the highest-leverage engineering investment for MCP distribution. No competitor covers all four.

7. **DACH is the geographic beachhead** — Not the primary message, but the wedge for European enterprise adoption where no competitor has presence.

### 7.2 Execution Roadmap

| Phase | Timeline | Actions |
|-------|----------|---------|
| **Phase 0: Launch readiness** | Week 1-2 | Current surface is launch-ready. Verify all tools work correctly. |
| **Phase 1: Marketplace distribution** | Week 2-4 | Submit to Cline Marketplace, Devin Marketplace, Cursor Marketplace, MCP.Directory, PulseMCP. Update Smithery listing with richer description. |
| **Phase 2: Richer returns** | Month 2 | Add confidence scores, cost estimates, time estimates to tool returns. |
| **Phase 3: Multi-platform** | Months 3-6 | Add GitLab support. Add Jira support. Abstract issue reference model. |
| **Phase 4: DACH features** | Months 6-12 | EU data residency option. German PR output. Audit log. Approval gate. |

### 7.3 Metrics

| Metric | Current | Target (3 months) | Target (6 months) |
|--------|---------|-------------------|-------------------|
| MCP marketplace listings | 1 (Smithery) | 5+ (all major) | 8+ (all + niche) |
| MCP tool adoption (% of fixes via MCP) | ~0% (unmeasured) | 10% | 30% |
| Agent platform coverage | 1 (indirect) | 5+ platforms | 10+ platforms |
| Fix success rate via MCP | Same as webhook (92%) | Same or higher | Same or higher |
| MCP server installs | ~0 (unlisted outside Smithery) | 100+ | 1,000+ |

### 7.4 Immediate Next Steps (Execution Tickets)

1. **AIM-3362** — Submit STAS MCP server to Cline Marketplace and Devin Marketplace
2. **AIM-3363** — Add `stas_analyze_pr` tool to MCP surface
3. **AIM-3364** — Add confidence score and cost estimate returns to `stas_fix_issue` and `stas_estimate`
4. **AIM-3365** — Abstract issue reference model for multi-platform support (GitLab, Jira, Linear)
5. **AIM-3366** — Update Smithery listing with richer description, screenshots, and usage examples
6. **AIM-3367** — Write MCP-specific onboarding guide for agent developers

---

## References

- STAS MCP Agent Server: `src/mcp/agentServer.ts` — 7 tools, 4 resources, 2 prompts over JSON-RPC 2.0
- MCP Server JSON: `stas/mcp-server.json` — Smithery listing manifest
- STAS Registry: `stas/stas-registry.json` — marketplace presence across 5 channels
- Existing distribution plan: `docs/gtm/mcp-distribution-plan.md`
- Competitor research: `docs/gtm/competitor-research.md`
- DACH market analysis: `docs/gtm/germany-eu-taas-market-analysis.md`
- OpenHands MCP docs: https://docs.openhands.dev/openhands/usage/settings/mcp-settings
- Devin MCP docs: https://docs.devin.ai/work-with-devin/devin-mcp
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Smithery directory: https://smithery.ai
- Cline MCP Marketplace: https://github.com/cline/mcp-marketplace
- MCP.Directory: https://mcp.directory
- MCP Server Ecosystem 2026: https://callsphere.ai/blog/mcp-server-ecosystem-2026-most-used-protocol-servers.md
