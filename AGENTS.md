# SYNTARO — Solving Tickets As A Service

## Skill Installation

SYNTARO is available as a downloadable OpenCode skill. Any OpenCode, OpenClaw, or Claude Code agent can install it:

**OpenCode/OpenClaw:**
```bash
# Install via skill URL
opencode skill install https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/skills/syntaro/SKILL.md
```

Or add to `opencode.json`:
```json
{
  "skills": {
    "syntaro": {
      "url": "https://raw.githubusercontent.com/Aimino-Tech/solving_tickets_as_a_service/main/skills/syntaro/SKILL.md"
    }
  }
}
```

**Claude Code (via MCP):**
```bash
npx syntaro install-mcp --claude
```

The skill exposes tools for submitting GitHub issues, checking fix status, and retrieving results. See `skills/syntaro/SKILL.md` for the full reference.

## One-liner

Label a GitHub issue. SYNTARO investigates, fixes, and opens a PR. You review and merge.

## What this project is

An open-source GitHub bot that turns labeled issues into pull requests. Backed by OpenCode's agent harness with frontier models (claude-sonnet-4, GPT-4o).

### Key insight

Every competitor (Plip, TaskBounty, KintsugiBot, Open SWE, OpenRonin) wraps Claude/GPT. SYNTARO differentiates on **execution quality** and **integrated pipeline**, not model exclusivity.

## Architecture

```
GitHub Issue (labeled "syntaro:fix")
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

SYNTARO has **three paths**, all pointing to paid plans for full features:

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
| **SYNTARO (OSS)** | **Frontier models** | **✅** | **✅** | **Minimal** | **OpenCode native** |

## Agent economics (real data from XOR benchmark)

| Agent | Cost/fix | Pass rate |
|---|---|---|
| Claude Opus 4.5 (direct) | $2.64 | 45.7% |
| GPT-5.2 Codex | $5.30 | 62.7% |
| GPT-5.5 (DeepSWE) | $5.80 | 70.0% |
| OpenCode + Opus 4.6 | $51.88 | 47.5% |

SYNTARO with claude-sonnet-4 achieves 92% pass rate at ~$3.80/fix by combining OpenCode's agent harness with effective model routing and prompt optimization.

## Key design decisions

1. **Label trigger** (`syntaro:fix`) — zero config, familiar from Plip
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

## MCP Agent Server (AIM-3240)

SYNTARO exposes a TypeScript-based MCP (Model Context Protocol) server at `/mcp/jsonrpc` for AI agent discovery. Agents can discover and call SYNTARO tools over JSON-RPC 2.0.

### Endpoint

```
POST /mcp/jsonrpc
Content-Type: application/json
```

### Methods

#### `tools/list` — List all available tools

Request:
```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
```

Response includes: `syntaro_fix_issue`, `syntaro_check_status`, `syntaro_list_runs`, `syntaro_get_run`.

#### `tools/call` — Invoke a tool

**syntaro_fix_issue**: Dispatch a fix run for a GitHub issue.
```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "syntaro_fix_issue", "arguments": { "repoOwner": "owner", "repoName": "repo", "issueNumber": 42 } }
}
```

**syntaro_check_status**: Check fix run status by runId.
```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "syntaro_check_status", "arguments": { "runId": "uuid" } }
}
```

**syntaro_list_runs**: List recent fix runs with optional status filter.
```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "syntaro_list_runs", "arguments": { "limit": 20, "status": "completed" } }
}
```

**syntaro_get_run**: Get full details for a fix run.
```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "syntaro_get_run", "arguments": { "runId": "uuid" } }
}
```

#### `resources/list` — List available resources

Request:
```json
{"jsonrpc": "2.0", "id": 1, "method": "resources/list"}
```

Resources: `syntaro://runs/{runId}`, `syntaro://issues/{issueId}`.

#### `resources/read` — Read a resource

```json
{
  "jsonrpc": "2.0", "id": 1, "method": "resources/read",
  "params": { "uri": "syntaro://runs/some-uuid" }
}
```

### Architecture

The MCP agent server (`src/mcp/agentServer.ts`) is an Express router mounted at `/mcp/jsonrpc`. It:

- Stores job state in Redis (shared with `src/routes/mcp.ts`)
- Dispatches fix runs via RabbitMQ to the existing pipeline
- Uses JSON-RPC 2.0 over HTTP POST for MCP protocol compliance
- Reuses existing `McpJobStatus`, `McpRunHistoryEntry` types from `src/opencode-contract.ts`

### Agent Discovery Flow

```
AI Agent
  │
  ├─ POST /mcp/jsonrpc { method: "tools/list" }
  │     → Discovers syntaro_fix_issue, syntaro_check_status, etc.
  │
  ├─ POST /mcp/jsonrpc { method: "tools/call", name: "syntaro_fix_issue", args: {...} }
  │     → Run created, dispatched to RabbitMQ pipeline
  │
  └─ POST /mcp/jsonrpc { method: "tools/call", name: "syntaro_check_status", args: { runId } }
        → Returns current status (queued → investigating → fixing → ... → completed/failed)
```

---

## SYNTARO Prompt Preamble (ALWAYS-ON — every prompt to OpenCode, incl. subagents/pods)

**Full source of truth:** `docs/oc-prompt-preamble.md` (this repo). This section is the condensed always-on version; every session, task dispatch, and worker pod prompt must carry it.

### Work discipline
- **Do it once, make it work** — careful planning over trial/error; read first, minimal change, verify with real commands.
- **Evidence before claims** — every "done/fixed/score X" backed by actual command output/test run/PR URL. No fabricated results.
- Work in isolated git worktree / fresh clone; never in shared checkouts or dirty working trees.
- Branch + PR, never push to main directly. PR body documents env vars + evidence.
- Checkboxes (story/AC checklists) checked ONLY with evidence.

### LLM-routing principle ("Nicht pauschal")
- No single model for everything. 70–80% of tasks (formatting, summaries, RAG, routine edits) need NO frontier model — a cheap model (DeepSeek V4-Flash) suffices at a fraction of cost.
- Frontier models ONLY for deep reasoning, complex logic, advanced coding.
- Cascade/fallback: escalate to a stronger model when classification is uncertain or confidence is low.
- Apply to yourself: don't burn tokens on trivia, but escalate on real reasoning.

### Product context (SYNTARO stack)
- **Website**: `Aimino-Tech/syntaro-website` (Vite 6 + React 18 + TS + shadcn, EN+DE, Vercel functions `functions/api/`, eval in `eval/`).
- **Webapp**: `Aimino-Tech/solving_tickets_as_a_service` → `dashboard/` (Vite SPA, JWT/GitHub OAuth, i18n de/en/es/fr) + Express `src/` (steering proxy `/api/v1/admin/steering/*`).
- **Backend**: `Aimino-Tech/OpenSymphony` — Elixir API (`/api/v1/*`), Python admin `admin/main.py` (:8765, Bearer `ADMIN_API_KEY`, billing `/api/billing/*`), Difficulty-Routing on main.
- **Usage/billing source**: `Aimino-Tech/llm-governance` (`usage_analytics.py`, `token_budget.py` `PROVIDER_RATES`, sinks SQLite/CSV/webhook). Billing = metered from historical usage (OpenCode-style), NOT prepaid credits.

### Focus themes (2026-08-04, user-confirmed) — ALL work must reflect these
1. **Bitbucket** — the entire integration is missing; cover website, webapp, backend, admin (webhook `/api/v1/webhook/bitbucket` exists in OS).
2. **Monitoring-induced incident tracking** — alerts → incidents → fix runs, SEV + confidence gate, queue/status/notifications.
3. **EU people** — GDPR, data residency (EU hosting), DPA, DE parity, honest compliance. **ISO 27001 + ISO 9001 QM prominent** (trust bar, compliance page, honest certified-vs-in-progress status).
4. **Website not overloaded** — nav ≤5 items, one-page anchors, footer absorbs secondary (openworker.com reference).

### Standards
- Per-story checklists checked with evidence; no placeholders (Acme banned); EN+DE complete; Lighthouse ≥ 90 (website); screenshots 375/768/1280; no credentials in client bundles (secrets server-side via env).
- Repo warnings: `llm-governance` local tree is dirty (AIM-4492) — never work there; fresh clone/worktree. `OpenSymphony` has a concurrent agent — don't clobber foreign branches. GitHub token lacks `workflow` scope — cannot push `.github/workflows/*` (needs `gh auth refresh -s workflow`). CI checks are billing-blocked (GH account) — verify locally, don't wait on CI.
