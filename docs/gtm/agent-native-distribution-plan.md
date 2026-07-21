# STAS Agent-Native Distribution Plan

> **Goal**: Define the MCP niche for STAS as the undisputed best MCP server for any AI agent solving SWE tickets, and outline an agent-native distribution model that makes this defensible.

---

## Table of Contents

1. [MCP Ecosystem Analysis](#1-mcp-ecosystem-analysis)
2. [Competitive MCP Positioning](#2-competitive-mcp-positioning)
3. [Niche Recommendation](#3-niche-recommendation)
4. [Distribution Model](#4-distribution-model)
5. [Recommended MCP Surface](#5-recommended-mcp-surface)
6. [Risk Assessment](#6-risk-assessment)
7. [Recommendations](#7-recommendations)

---

## 1. MCP Ecosystem Analysis

### 1.1 Current State (July 2026)

The Model Context Protocol (MCP) has crossed from niche developer protocol into mainstream agent infrastructure:

| Metric | Value | Source |
|--------|-------|--------|
| Monthly SDK downloads | 110M+ | Anthropic AAIF announcement, Dec 2025 |
| Active public servers | 10,000+ | Official MCP Registry API |
| GitHub repos with mcp-server topic | 15,926 | GitHub Search API, May 2026 |
| modelcontextprotocol/servers stars | 86,148 | GitHub API, May 2026 |
| Enterprise production adoption | 41% of surveyed orgs | Stacklok State of MCP 2026 report |

**Key inflection points**:

- **Nov 2024** — Anthropic launches MCP publicly (~2M monthly downloads)
- **Mar 2025** — OpenAI adopts MCP (22M downloads) — the decisive signal that MCP won
- **Apr 2025** — Google DeepMind adopts MCP across Gemini
- **Jul 2025** — Microsoft integrates MCP into Copilot Studio (45M downloads)
- **Nov 2025** — AWS Bedrock support (68M downloads)
- **Dec 2025** — Anthropic donates MCP to Linux Foundation's Agentic AI Foundation (AAIF); OpenAI, AWS, Google, Microsoft, Cloudflare, Bloomberg join as co-founders
- **May 2026** — MCP 2026-07-28 release candidate published — largest revision since launch
- **Jul 28, 2026** — Final spec ships (expected)

### 1.2 Agent Platforms Supporting MCP

Every major AI agent platform now supports MCP tool discovery and invocation:

| Platform | MCP Support | Discovery Model | Notes |
|----------|-------------|----------------|-------|
| **Claude Code** | Native | Configured via claude_desktop_config.json | Primary MCP reference client |
| **Claude Desktop** | Native | Config file + directory | Reference client |
| **ChatGPT** | Native (since Mar 2025) | Connectors + Responses API | OpenAI deprecated Assistants API for MCP |
| **Cursor** | Native | .cursor/mcp.json config | MCP servers in Composer |
| **VS Code** | Native (via Copilot) | Configuration | GitHub MCP server integration |
| **Cline** | Native | Built-in MCP Marketplace | Most extensible agent w.r.t. MCP |
| **Gemini** | Native | SDK-level MCP support | Google's agent builder |
| **Copilot Studio** | Native | Enterprise agent builder | Microsoft's enterprise MCP surface |
| **Continue** | Native | Open-source, IDE-agnostic | JetBrains + VS Code |
| **Replit** | Native | Browser-based agent environment | AI agent integration |
| **Windsurf** | Native | Cascade agent mode | Codeium's AI IDE |
| **OpenCode** | Native | MCP tool discovery | Terminal-based agent harness |
| **Aider** | Native | MCP server config | OSS pair programming |

### 1.3 MCP Protocol Roadmap & Maturity

The 2026-07-28 release candidate introduces the largest revision since launch:

**Breaking changes (July 28, 2026)**:

- **Stateless core** — The `initialize`/`initialized` handshake and `Mcp-Session-Id` header are removed. Every request carries its own context in `_meta`. Servers can run behind any round-robin load balancer with no sticky routing.
- **Streamable HTTP** — `Mcp-Method` and `Mcp-Name` headers required for routing without body inspection.
- **Caching** — `tools/list` and resource read results carry `ttlMs` and `cacheScope` for client-side caching.
- **W3C Trace Context** — `traceparent`, `tracestate`, `baggage` in `_meta` for OTel compatibility.

**New capabilities**:

| SEP | Feature | Impact |
|-----|---------|--------|
| SEP-2322 | Multi-round-trip requests | Server sends partial results, requests clarification |
| SEP-2567 | State handles | Opaque tokens for composable sessionless workflows |
| SEP-2575 | Stateless mode | Server capability declaration — no session management needed |
| SEP-1865 | MCP Apps | Servers ship interactive HTML UIs rendered in sandboxed iframes |
| SEP-2774 | OAuth Device Auth | Headless/constrained-device authentication |
| SEP-2704 | Audit context | Standard audit metadata on every tool call |
| SEP-2797 | Crypto proof-of-possession | Prevents token theft and replay |
| SEP-2767 | CTEF trust scoring | Cross-ecosystem trust evidence for MCP servers |

**Implication for STAS**: The stateless migration (July 28) is mandatory. STAS's MCP server must be updated to the 2026-07-28 spec within the migration window. The existing session-based Redis state must be adapted to the new stateless model.

### 1.4 MCP Marketplaces & Discovery

The MCP ecosystem has fragmented into multiple discovery platforms:

| Marketplace | Listings | Security Audit | Install Model | Best For |
|-------------|----------|---------------|---------------|----------|
| **Smithery** | 3,000+ | Limited | CLI + hosted execution | Quick prototyping |
| **Glama** | 6,000+ | None | Config download | Discovery with quality scores |
| **PulseMCP** | 21,000+ | None | Config download | Largest catalog breadth |
| **MCP.so** | 19,000+ | None | Manual config | Community-curated browsing |
| **MCP Market** | 10,000+ | None | Cline-integrated | Category browsing |
| **MCP.Directory** | 3,000+ | None | One-click install | Client integration support |
| **MarketNow** | 8,764 | 6-layer Sentinel | CLI + cert verification | Security-conscious users |
| **Official Registry** | 500+ (curated) | Submission review | Manual | Enterprise trust baseline |
| **Apigene** | 251+ (verified) | OWASP scanning | One-click + gateway | Enterprise procurement |

**Key insight**: No marketplace currently verifies or curates "SWE ticket solving" MCP servers. This is an open category.

### 1.5 Popular MCP Server Categories

Most popular MCP servers by category (based on installs across marketplaces):

| Category | Examples | Adoption Driver |
|----------|----------|-----------------|
| Databases | PostgreSQL, SQLite, MongoDB | Direct data access for agents |
| Version Control | GitHub, GitLab | Repository operations |
| Browser Automation | Playwright, Puppeteer | Web-based tasks |
| Search/Knowledge | Web search, Semantic Scholar | Information retrieval |
| Productivity | Google Workspace, Notion, Slack | Enterprise workflows |
| Cloud Infrastructure | AWS, Kubernetes, Cloudflare | DevOps automation |
| Communication | Slack, Atlassian (Jira+Confluence) | Ticket and messaging |

**Notable absence**: No MCP server in the top categories is specifically designed for **autonomous SWE ticket solving** (investigate → fix → PR). This is the gap STAS fills.

---

## 2. Competitive MCP Positioning

### 2.1 Competitor MCP Analysis

| Competitor | MCP Server Exists? | SWE Ticket Solving? | Agent-Discoverable? | Notes |
|------------|-------------------|---------------------|--------------------|-------|
| **GitHub Official MCP** | ✅ Yes | ❌ No (read/search only) | ✅ | Read repos, issues, PRs. No write/fix capability. |
| **GitLab MCP** | ✅ Yes (community) | ❌ No | ⚠️ Limited | Basic MR operations. No fix pipeline. |
| **Linear MCP** | ✅ Yes | ❌ No | ✅ | Issue/project management. No code changes. |
| **Jira MCP** | ✅ Yes (Atlassian) | ❌ No | ✅ | Ticket operations only. |
| **Devin** | ❌ No (Web UI only) | ✅ Yes (proprietary) | ❌ | No MCP endpoint. No agent-native discovery. |
| **OpenHands** | ❌ No (CLI/SDK) | ⚠️ Partial | ❌ | No MCP server. Docker-based execution. |
| **Copilot** | ⚠️ Via GitHub MCP | ⚠️ Agent mode | ❌ | IDE-bound, GitHub only. |
| **Factory Droid** | ❌ No | ⚠️ Partial | ❌ | Proprietary multi-agent. No MCP. |
| **Cline** | ⚠️ Via other MCPs | ❌ No (IDE-bound) | ✅ | Can call MCP tools but has no fix pipeline itself. |
| **Claude Code** | ⚠️ Via other MCPs | ⚠️ Via agent | ✅ | Can discover MCP tools but has no dedicated fix server. |
| **STAS** | **✅ Yes (4 tools + resources + prompts)** | **✅ Full pipeline** | **✅ MCP-native** | **First and only MCP server for async issue→PR.** |

### 2.2 How Agents Currently Handle "Fix This Bug" Without STAS

When an AI agent encounters a "fix this bug" request without a dedicated MCP server:

1. **Direct code manipulation** — Agent clones repo locally, patches code, commits via git CLI
2. **GitHub API calls** — Agent uses generic HTTP/API tools against GitHub REST/GraphQL
3. **Manual PR creation** — Agent creates PRs through browsers or API calls, no verification
4. **Via IDE** — Agent in Cursor/VS Code makes local edits, user reviews in-editor

**Quality gaps without STAS**:

| Dimension | Agent Fixing Directly | STAS MCP Server |
|-----------|---------------------|-----------------|
| Repo context | Limited to agent's context window | Full repo clone, investigation |
| Test verification | Often skipped | Required gate (existing + new) |
| PR quality | Inconsistent formatting, no description | Standardized PR with analysis |
| Sandbox isolation | Agent's own environment | Docker/E2B sandbox |
| Async capability | Blocking (agent must wait) | Fire-and-forget with status polling |
| Multi-platform | GitHub only (usually) | GitHub + GitLab + Jira + Linear |
| Cost optimization | No routing | Model routing (cheap triage → expensive fix) |

### 2.3 MCP Gap Analysis

The MCP ecosystem has tools for **reading** (GitHub MCP, GitLab MCP) and tools for **managing** (Linear MCP, Jira MCP) but no tool for **solving** — the critical investigation-fix-PR pipeline.

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Ecosystem Map                         │
├─────────────┬─────────────────┬─────────────────────────────┤
│  Read Layer │  Manage Layer   │  Solve Layer (EMPTY → STAS) │
├─────────────┼─────────────────┼─────────────────────────────┤
│ GitHub MCP  │ Linear MCP      │ stas_fix_issue              │
│ GitLab MCP  │ Jira MCP        │ stas_batch_fix              │
│ Repo reader │ Project MCP     │ stas_triage                 │
│ File viewer │ Task MCP        │ stas_estimate               │
│ Issue reader│                 │ stas_check_status           │
│             │                 │ stas_list_runs              │
│             │                 │ stas_get_run                │
└─────────────┴─────────────────┴─────────────────────────────┘
```

**STAS is uniquely positioned as the Solve Layer connector** — agents discover STAS's tools, feed it an issue reference, and STAS handles the entire investigation → fix → PR lifecycle asynchronously.

---

## 3. Niche Recommendation

### 3.1 Primary Niche

> **The universal MCP solve layer — agents discover STAS as the only tool that turns any issue reference (GitHub, GitLab, Jira, Linear) into a verified PR, with zero human setup, async execution, and production-grade safety.**

### 3.2 Why This Niche is Defensible

**Narrowest defensible position**: "Multi-platform issue-to-PR via MCP for AI agents"

| Factor | Analysis |
|--------|----------|
| **Agent-native** | STAS's MCP server is already the only one exposing issue→PR tools. First-mover advantage in agent tool registries. |
| **Multi-platform** | No competitor covers GitHub + GitLab + Jira + Linear through a single MCP endpoint. Building this is hard — each platform requires different auth models, API quirks, and webhook integrations. |
| **Async execution** | Most MCP servers are synchronous (call → return). STAS's fire-and-forget model (queued → investigating → fixing → testing → PR) is architected differently and hard to retrofit. |
| **Verification gate** | Agents can call `stas_fix_issue` without knowing the codebase. The verification gate (tests must pass) provides a quality guarantee no read-only MCP server offers. |
| **DACH compliance option** | EU data residency + German output + approval gates is a moat for DACH enterprise adoption. No MCP server offers this today. |

### 3.3 Sub-Niches (for phased rollout)

| Sub-Niche | Description | Timeline | Priority |
|-----------|-------------|----------|----------|
| **Agent-native fix** | Any agent (Claude Code, Cline, Cursor) can discover STAS and dispatch fixes | Phase 0 (now) | Highest |
| **Multi-platform bridge** | Unified MCP surface across GitHub, GitLab, Jira, Linear | Phase 1 (0-3mo) | High |
| **DACH-compliant fix** | EU data residency, German output, approval gates, audit logs | Phase 2 (3-6mo) | Medium |
| **Agent-native triage** | Agents use STAS to prioritize which issues to fix | Phase 1 (0-3mo) | High |
| **Batch fix orchestration** | Agents dispatch multiple fixes, STAS manages parallel runs | Phase 1 (0-3mo) | Medium |

### 3.4 Niche Adjacency Analysis

```
                        Niche Heat Map
                    
                    Unique to STAS    Contested
                    ─────────────     ─────────
High Value          ● Async issue→PR  ● Direct code editing
                    ● Multi-platform   ● GitHub API tools
                    ● Verification     ● IDE integrations
                    ● DACH compliance
                    
Lower Value         ● Status polling  ● Issue reading
                    ● Batch dispatch   ● PR commenting
                       (easy to copy)     (commodity)
```

**The defensible core**: Async issue→PR pipeline with verification, accessed through a discoverable MCP server interface. The pipeline is the moat, not the individual tools.

---

## 4. Distribution Model

### 4.1 Agent-Native Distribution vs Current Model

| Dimension | Current (GitHub-label/Webhook) | Agent-Native (MCP) |
|-----------|-------------------------------|-------------------|
| **Trigger** | Label `stas:fix` on issue | Agent calls `stas_fix_issue` tool |
| **User** | Human (labels issue) | AI agent (discovers and calls tool) |
| **Discovery** | GitHub UI / README | MCP tools/list → agent picks tool |
| **Setup** | GitHub App installation | MCP server URL in agent config |
| **Audience** | Developers on GitHub | All AI agent users on any platform |
| **Virality** | Word of mouth | Agent recommends STAS to other agents |

### 4.2 Agent Discovery Virality Loop

```
Agent needs to fix an issue
       │
       ▼
Agent calls tools/list on STAS MCP server
       │
       ▼
Agent discovers stas_fix_issue, stas_triage, stas_estimate
       │
       ▼
Agent dispatches fix, gets successful PR
       │
       ▼
Agent logs: "Fixed via STAS" in PR description
       │
       ▼
Another agent reads the PR, discovers STAS
       │
       ▼
Loop repeats ──────────────────────────┘
```

**Key insight**: Every PR STAS creates becomes a distribution channel. AI agents reading PRs see "Fixed via STAS" and can discover the MCP server through the PR metadata or commit messages.

### 4.3 Distribution Paths

#### Path A: Bundled Distribution (Pre-installed)

| Platform | Integration | Effort | Reach |
|----------|-------------|--------|-------|
| **Smithery** | One-click MCP deploy + listing | Low | 3K+ developers |
| **Cline MCP Marketplace** | Curated listing in Cline | Low | High (Cline users are MCP-heavy) |
| **MCP.Directory** | Listing with install button | Low | Growing directory |
| **Claude Code MCP directory** | Recommended MCP server | Medium | Very high (Claude Code users) |
| **Cursor** | MCP server templates | Medium | High (Cursor has large install base) |

**Recommendation**: Pursue all low-effort listings immediately (Smithery, Cline, MCP.Directory, Glama, mcp.so). These are free and create distribution surface.

#### Path B: On-Demand Discovery (Runtime)

| Mechanism | How STAS Gets Found | When It Matters |
|-----------|--------------------|-----------------|
| **MCP Registry API** | tools/list at connection time | Every agent that connects to STAS |
| **Server discovery** | .well-known/mcp URL | Phase 2 (protocol matures) |
| **Agent recommendation** | Agent logs "Installing STAS recommended by agent..." | Viral loop |
| **PR metadata** | "Fixed via STAS" in PR footer | Cross-agent discovery |

**Recommendation**: Optimize for the `tools/list` response — this is the first thing every agent sees. Tool descriptions should be clear, action-oriented, and include confidence signals.

#### Path C: Marketplace Listings (Targeted)

| Marketplace | Install Action | Priority | Notes |
|-------------|---------------|----------|-------|
| **Smithery** | `npx @smithery/cli install stas` | P0 | Largest MCP-specific marketplace |
| **Cline Marketplace** | In-IDE install | P0 | Cline users are the most MCP-hungry |
| **Glama** | Quality score + listing | P1 | Algorithmic discovery |
| **MCP.Directory** | One-click install button | P1 | Broad client compatibility |
| **mcp.so** | Community listing | P1 | Large browse audience |
| **MarketNow** | Security-certified listing | P2 | If STAS pursues security differentiation |
| **Official Registry** | PR-based listing | P2 | Trust signal for enterprises |

### 4.4 What's the Analogous Adoption Pattern?

**How successful MCP servers gained adoption**:

| Server | Adoption Pattern | Key Tactic | STAS Takeaway |
|--------|-----------------|------------|---------------|
| **PostgreSQL MCP** | Viral CLI — devs installed for local DB access | "10 seconds to connect" | One-liner install for STAS |
| **GitHub MCP** | First-party from Anthropic, bundled with Claude | Pre-installed trust | Get listed on official channels |
| **Playwright MCP** | Reference implementation, excellent docs | Blog posts + examples | Technical content about STAS + MCP |
| **Atlassian MCP** | Enterprise demand pull from Jira/Confluence users | OAuth simplicity | Make STAS authless for GitHub public |

**STAS strategy**: Combine all three — one-liner install, first-party-level documentation, and enterprise auth that "just works."

### 4.5 Partnership Opportunities

| Partner | Why | What STAS Gets | What They Get |
|---------|-----|----------------|---------------|
| **Smithery** | Largest MCP marketplace | Distribution, hosted execution | New server in catalog |
| **Cline** | Most MCP-extensible agent | In-marketplace listing | SWE fix capability for Cline users |
| **Claude Code team** | Reference agent platform | Recommended status | Reference MCP solve server |
| **Cursor** | AI IDE with large user base | MCP template inclusion | Issue→PR flow in IDE |
| **OpenCode** | Terminal agent harness | Native integration | MCP solve server for OpenCode users |
| **MCP.Directory** | Cross-client directory | Discovery across 10+ clients | New solve-layer server |

---

## 5. Recommended MCP Surface

### 5.1 Design Principles

1. **Agent-optimized descriptions** — Every tool description must tell the agent *when* to use it, not just *what* it does
2. **Structured returns** — Machine-parseable JSON with confidence scores so agents can make decisions
3. **Progressive disclosure** — Cheap tools first (estimate, triage), then expensive tools (fix)
4. **Async-first** — Return immediately with a runId, let the agent poll or subscribe
5. **Self-documenting** — Tools/resources carry enough metadata that agents self-correct errors

### 5.2 Tool Surface (Recommended, Not Implementation Spec)

#### Phase 0 — Current (Ship Now)

| Tool | Purpose | Agent Benefit |
|------|---------|---------------|
| `stas_fix_issue` | Dispatch a fix run | Single call to fix any issue |
| `stas_check_status` | Poll fix progress | Async awareness |
| `stas_list_runs` | View history | Context for decisions |
| `stas_get_run` | Full run details | Deep inspection |
| `stas_batch_fix` | Fix multiple issues | Scale out |
| `stas_triage` | Score fixable issues | Prioritization |
| `stas_estimate` | Complexity/effort/risk analysis | Cost-aware decisions |

**These are live**. The remaining tools should ship in prioritized order.

#### Phase 1 — Enhanced Decision Support (0-3 Months)

| Tool | Description | Why Agents Need It |
|------|-------------|--------------------|
| `stas_explain_issue` | Return human-readable issue analysis + suggested approach | Agent decides *whether* to fix without committing resources |
| `stas_suggest_approach` | Return fix plan (files to modify, strategy) before execution | Agent approves plan before execution |
| `stas_estimate` (enhanced) | Return repo-specific cost/confidence based on history | Accurate predictions improve agent decision-making |
| `stas_auto_fix` | Combined estimate + fix in one call (for high-confidence issues) | Reduce round trips for confident fixes |

#### Phase 2 — Agentic Workflow (3-6 Months)

| Tool | Description | Strategic Value |
|------|-------------|-----------------|
| `stas_review_pr` | Review an existing PR | Close the loop — STAS reviews PRs too |
| `stas_create_branch` | Create fix branch without PR (CI integration) | Integration with existing agent workflows |
| `stas_rollback` | Roll back a STAS-created PR if test fails | Safety net for production |
| `stas_generate_test` | Generate regression test for an issue | Verification-first approach |

### 5.3 Resource Templates

| Resource | Purpose | Status |
|----------|---------|--------|
| `stas://runs/{runId}` | Full run details | ✅ Live |
| `stas://issues/{issueId}` | Issue details with fix status | ✅ Live |
| `stas://issues/{issueId}/context` | Full context bundle (description, comments, files) | ✅ Live |
| `stas://repos/{repo}/heuristics` | Repo-specific fix patterns, success history | ✅ Live |
| `stas://repos/{repo}/active-runs` | All active runs in a repo | Phase 1 |

### 5.4 Prompt Templates

| Prompt | Purpose | Status |
|--------|---------|--------|
| `stas_fix_pattern` | Guide an agent through fix workflow | ✅ Live |
| `stas_triage_pattern` | Guide agent through triage | ✅ Live |
| `stas_batch_pattern` | Guide agent through batch fix workflow | Phase 1 |

### 5.5 Minimum Viable MCP Surface

The irreducible set that makes STAS the default choice for agents:

```
Must Have (ship now):
  tools/list → stas_fix_issue, stas_estimate, stas_triage, stas_check_status
  resources/list → stas://runs/{id}, stas://issues/{id}/context
  
Should Have (Phase 1):
  stas_explain_issue, stas_suggest_approach
  stas://repos/{repo}/heuristics
  
Nice to Have (Phase 2):
  stas_review_pr, stas_rollback, stas_generate_test
```

### 5.6 Return Value Contract

Every tool call should return a structured object with these fields where applicable:

| Field | Purpose | Example |
|-------|---------|---------|
| `runId` | Async operation handle | `"uuid-v4"` |
| `status` | Current state | `"queued"`, `"investigating"` |
| `confidence` | STAS's confidence in success | `"high"`, `"medium"`, `"low"` |
| `costEstimate` | Estimated monetary cost | `0.15` |
| `timeEstimate` | Estimated time in seconds | `300` |
| `alternatives` | Other approaches the agent could try | `[{tool: "stas_explain_issue", ...}]` |
| `prUrl` | Link to created PR (when complete) | `"https://github.com/..."` |
| `message` | Human-readable status | `"Fix dispatched for repo#123"` |

**Why this matters**: Agents make decisions based on structured returns. Cost and confidence estimates let agents decide whether to proceed. Without these, the agent treats STAS as a black box.

---

## 6. Risk Assessment

### 6.1 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Agent platforms build native fix capabilities** | Medium | High | Double down on multi-platform + DACH. Native fix will be GitHub-only for 12+ months. |
| **MCP fails to become standard protocol** | Low | Critical | Keep REST API + webhook trigger. MCP is already the de facto standard (110M downloads, AAIF governance). |
| **MCP 2026-07-28 breaking changes** | Certain | Medium | Migration required by spec timeline. Stateless migration is straightforward for existing architecture. |
| **Competitor launches MCP fix server first** | Medium | Medium | STAS already has the MCP server live. First-mover advantage in agent tool registries. Speed of execution matters. |
| **Security concerns limit MCP adoption** | Medium | High | Build security-first posture. Audit logging, approval gates, and trust scoring turn risk into differentiation. |
| **GitHub Copilot Agent matures** | Medium-High | High | Copilot is GitHub-only. STAS's multi-platform + DACH moat is independent of GitHub-specific competition. |
| **Shadow MCP concerns in enterprise** | Medium | Medium | Enterprise STAS deployment through gateway architecture. VPC / on-prem option for regulated customers. |
| **Pricing pressure from OSS competitors** | Low | Medium | Self-hosted OSS is a funnel to Cloud Paid. Critical mass of agents using STAS creates switching costs. |

### 6.2 What If MCP Doesn't Win?

MCP is already the de facto standard, but if it were displaced:

- **A2A (Agent-to-Agent) by Google** — Complements MCP, doesn't compete. MCP is agent→tool, A2A is agent→agent.
- **Proprietary protocols** — OpenAI Assistants API being deprecated *for* MCP. Microsoft, Google, AWS all adopted MCP.
- **New standard** — AAIF governance means no single vendor controls the protocol. Exit cost for tool builders is low (JSON-RPC is universal).

**Fallback**: STAS's REST API + webhook trigger remain functional regardless of protocol. The MCP surface is an *additional* distribution channel, not the only one.

### 6.3 Window of Opportunity

| Timeline | Threat | STAS Response |
|----------|--------|---------------|
| **Now - 3 months** | No known competitor building MCP fix server | Ship MCP tools, list on all marketplaces |
| **3-6 months** | Devin/OpenHands may add MCP endpoint | First-mover advantage in agent registries |
| **6-12 months** | GitHub Copilot Agent may become competitive | Multi-platform + DACH moat established |
| **12+ months** | Commoditization of agent fix tools | Verification quality + compliance moat |

**The window is open for 3-6 months** before credible competitors add MCP support. STAS should use this window to:
1. Achieve critical mass in agent tool registries (tools/list rankings)
2. Build multi-platform integration (GitLab, Jira, Linear)
3. Establish DACH compliance features

---

## 7. Recommendations

### 7.1 Immediate (0-30 Days)

- [ ] **List STAS on all MCP marketplaces** — Smithery, Cline Marketplace, Glama, mcp.so, MCP.Directory, MarketNow
- [ ] **Optimize tools/list descriptions** — Every tool description must include "when to use this" guidance for agents
- [ ] **Add structured return fields** — Ensure every tool returns costEstimate, confidence, timeEstimate
- [ ] **Create STAS MCP documentation page** — One-liner install for each major client (Claude Code, Cursor, Cline, VS Code)
- [ ] **Publish blog post** — "The First MCP Server for Autonomous Ticket Solving" — technical SEO for agent discovery

### 7.2 Short-Term (1-3 Months)

- [ ] **Migrate to MCP 2026-07-28 spec** — Stateless transport, Mcp-Method headers, caching support
- [ ] **Ship Phase 1 tools** — `stas_explain_issue`, `stas_suggest_approach`, enhanced `stas_estimate`
- [ ] **Build GitLab MCP integration** — Extend stas_fix_issue to accept GitLab issue references
- [ ] **Build Jira MCP integration** — Extend stas_fix_issue to accept Jira ticket references
- [ ] **Implement agent discovery virality** — Add "Fixed via STAS" to PR descriptions with MCP install hint
- [ ] **Submit to Smithery hosted** — Get STAS running on Smithery's infrastructure for zero-config agent access
- [ ] **Create agent demo** — Video / blog of Claude Code or Cline discovering and using STAS via MCP

### 7.3 Medium-Term (3-6 Months)

- [ ] **Build approval gate** — Human-in-the-loop before PR creation for regulated industries
- [ ] **Add EU data residency** — Hetzner-based deployment option
- [ ] **German-language PR output** — PR descriptions, commit messages in German
- [ ] **Audit log feature** — Exportable audit trail for compliance
- [ ] **Partner with Smithery for featured placement** — Negotiate first-page placement
- [ ] **OpenCode native integration** — STAS as a bundled MCP server in OpenCode

### 7.4 Strategic Positioning Statement

> **"STAS is the only MCP server that turns any issue into a verified PR — discoverable by any AI agent on any platform."**

### 7.5 Success Metrics

| Metric | Current | Target (3 months) | Target (6 months) |
|--------|---------|-------------------|-------------------|
| MCP tool invocations | 0 | 100/day | 1,000/day |
| MCP marketplace listings | 0 | 6+ marketplaces | 10+ marketplaces |
| % fix runs via MCP vs webhook | 0% | 30% | 60% |
| Agent platforms listing STAS | 0 | 3 (Smithery, Cline, Glama) | 6+ |
| Fix success rate (MCP) | Same as webhook | ≥90% | ≥92% |
| MCP server uptime | N/A | 99.9% | 99.95% |

---

## References

- Existing MCP server: `src/mcp/agentServer.ts`
- Current MCP plan: `docs/gtm/mcp-distribution-plan.md`
- Competitor research: `docs/gtm/competitor-research.md`
- TaaS market analysis: `docs/gtm/germany-eu-taas-market-analysis.md`
- MCP specification: https://modelcontextprotocol.io
- MCP 2026-07-28 release candidate: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- MCP adoption statistics (Digital Applied): https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026
- MCP ecosystem post-2025 (Rajeev Jain): https://rajeeja.github.io/blog/mcp-landscape-seps-community-2026/
- Smithery MCP marketplace: https://smithery.ai
- Cline MCP Marketplace: https://cline.bot/mcp-marketplace
- MCP.Directory: https://mcp.directory
