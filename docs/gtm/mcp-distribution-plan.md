# STAS Agent-Native Distribution Plan

## MCP Niche Definition

> The universal MCP bridge between any AI agent and any issue tracker (GitHub, GitLab, Jira, Linear) — turn tickets into PRs with zero human setup, discoverable by agents at runtime.

## Why This Niche

Every major AI agent now speaks MCP (Model Context Protocol). Claude Code, Cline, Cursor, Copilot, OpenHands — they all discover and invoke MCP tools dynamically. STAS already has a JSON-RPC 2.0 MCP server with 4 methods (`stas_fix_issue`, `stas_check_status`, `stas_list_runs`, `stas_get_run`). The opportunity: **distribution without a GUI** — agents discover STAS, not humans.

## Defensibility Matrix

| Dimension | STAS | Devin | OpenHands | Copilot |
|-----------|------|-------|-----------|---------|
| MCP-native API | ✅ Existing | ❌ Web UI only | ❌ CLI/SDK | ❌ IDE-only |
| Agent-discoverable | ✅ MCP list tools | ❌ | ❌ | ❌ |
| Multi-platform (GitHub+GitLab+Jira+Linear) | 🔲 Planned | ⚠️ GitHub+Jira only | ❌ GitHub only | ❌ GitHub only |
| Async issue→PR pipeline | ✅ Existing | ✅ | ⚠️ Partial | ⚠️ Agent mode |
| Self-host option | ✅ Existing | ❌ | ✅ | ❌ |
| DACH compliance | 🔲 Planned | ❌ | ❌ | ❌ |

## MCP Tool Suite

### Current Tools (Phase 0)

| Tool | Description | Status |
|------|-------------|--------|
| `stas_fix_issue` | Dispatch a fix run for a GitHub issue | ✅ Live |
| `stas_check_status` | Check status of a fix run by runId | ✅ Live |
| `stas_list_runs` | List recent fix runs with optional filters | ✅ Live |
| `stas_get_run` | Full run details by runId | ✅ Live |

### Phase 1 Tools (0-3 months)

| Tool | Description | Status |
|------|-------------|--------|
| `stas_fix_issue` (enhanced) | Richer return: estimated cost, estimated time, confidence score | ✅ Implemented |
| `stas_batch_fix` | Fix multiple issues in one invocation | ✅ Implemented |
| `stas_triage` | Score which issues in a repo are fixable | ✅ Implemented |
| `stas_estimate` | Complexity, effort, risk analysis for an issue | ✅ Implemented |

### Phase 1 Resources

| Resource | Description | Status |
|----------|-------------|--------|
| `stas://runs/{runId}` | Full run details | ✅ Existing |
| `stas://issues/{issueId}` | Issue details with fix status | ✅ Existing |
| `stas://issues/{issueId}/context` | Full context bundle for an issue | ✅ Implemented |
| `stas://repos/{repo}/heuristics` | Repository fix heuristics and patterns | ✅ Implemented |

### Phase 1 Prompts

| Prompt | Description | Status |
|--------|-------------|--------|
| `stas_fix_pattern` | Template for common fix patterns | ✅ Implemented |
| `stas_triage_pattern` | Template for triage analysis | ✅ Implemented |

## Ecosystem Integration Targets

| Platform | Integration Type | Priority |
|----------|-----------------|----------|
| Smithery | One-click MCP deploy | High |
| Claude Code | Recommended MCP server | High |
| Cline | MCP marketplace + built-in | High |
| Cursor | MCP tools in composer | Medium |
| OpenHands | Agent skill | Medium |
| GitHub Copilot | MCP bridge | Low |

## Metrics

- **MCP tool adoption**: % of fix runs triggered via MCP vs webhook/label
- **Agent ecosystem coverage**: # of agent platforms listing STAS as recommended MCP
- **Fix success rate via MCP**: parity or better vs label-triggered fixes
- **Agent discovery virality**: # of "STAS recommended by agent" events

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| MCP protocol changes | Implement against stable JSON-RPC 2.0 subset |
| Agent platforms build own fix capabilities | Double down on multi-platform coverage (GitLab, Jira) |
| Quality inconsistency from different agents | Strict input validation, versioned MCP API |
| MCP not becoming standard | Keep REST API as fallback, maintain webhook trigger path |
