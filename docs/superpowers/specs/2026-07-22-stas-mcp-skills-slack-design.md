# STAS as the Connector — MCP, Skills, Slack with OpenSymphony Backend

**Date**: 2026-07-22
**Status**: Approved
**Project**: STAS — Solving Tickets As A Service

## Vision

STAS is the **engine** that receives a ticket/issue through any interface (MCP, Skills, Slack, GitHub), runs the solve pipeline, and returns the result. The interface is just the entry point — the pipeline is the product.

```
GitHub Issue ─┐
Slack /stas   ─┤──→ OpenSymphony Pipeline ──→ OpenCode Agent → GitHub PR
MCP call      ─┘    (intent→plan→exec→collect→taste)          Slack DM
Skill call    ────────────────────────────────────────────────▶ MCP response
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STAS Engine                                  │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐ │
│  │ GitHub   │  │ Slack    │  │ MCP      │  │ OpenCode Skills     │ │
│  │ Webhook  │  │ Channel  │  │ Server   │  │ Registry            │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬─────────────┘ │
│       │              │              │                │               │
│       ▼              ▼              ▼                ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Unified Event Router                              │   │
│  │  Normalizes: { source, repoOwner, repoName, issueTitle,       │   │
│  │                issueBody, issueNumber, channel, channelTarget }│   │
│  └─────────────────────────┬────────────────────────────────────┘   │
│                            │                                         │
│                            ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              OpenSymphony Pipeline                             │   │
│  │                                                               │   │
│  │  ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ │   │
│  │  │ Intent │→│  Plan  │→│ Execute  │→│Collect │→│  Taste   │ │   │
│  │  │classify│ │approach│ │OpenCode  │ │results │ │score/QA  │ │   │
│  │  └────────┘ └────────┘ └──────────┘ └────────┘ └──────────┘ │   │
│  └────┬──────────┬──────────┬──────────┬──────────┬──────────────┘   │
│       │          │          │          │          │                  │
│       ▼          ▼          ▼          ▼          ▼                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Progress Publisher                                │   │
│  │  Sends real-time updates to: GitHub comments, Slack DM/thread, │   │
│  │  MCP resource updates, Skills callbacks                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Result: PR on GitHub, status in Slack, response via MCP            │
└─────────────────────────────────────────────────────────────────────┘
```

## Current State Analysis

### What exists already

| Component | Status | Location |
|-----------|--------|----------|
| **MCP Server** | Standalone Python FastMCP, JSON file registry, no real dispatch | `stas_mcp/` |
| **MCP REST Router** | REST shortcuts in Express, proxies to Python MCP | `src/mcp.ts` |
| **Skill Definition** | Static markdown docs, not downloadable | `stas/skill.md`, `skills/stas/` |
| **Slack Notifications** | Bolt app + webhook notifier, outbound only | `src/notifications/slack.ts`, `slack-bolt.ts` |
| **Telegram Channel** | Bidirectional, in `channels/` | `src/channels/telegram.ts` |
| **WhatsApp Channel** | Bidirectional, in `channels/` | `src/channels/whatsapp.ts` |
| **OpenSymphony Adapter** | HTTP server with placeholder stages (log + return) | `src/opensymphony-adapter.ts` |
| **Pipeline Executor** | Template-driven, session orchestration, state machine | `src/pipeline/` |
| **Queue/Worker** | RabbitMQ + worker that dispatches to OpenCode | `src/queue/`, `src/workers/` |

### Key Gaps

1. **OpenSymphony stages are placeholders** — `IntentStage`, `PlanningStage`, `ExecutionStage`, `CollectionStage`, `TasteStage` all log + return, no real agent dispatch
2. **MCP bypasses the pipeline** — `run_fix` handler writes to a JSON file, tries internal queue URL that may not exist
3. **Slack is not a channel** — in `src/notifications/` (outbound only), not in `src/channels/` like Telegram
4. **Skills are static files** — not actual downloadable OpenCode skills

## Ticket 1: Real OpenSymphony Pipeline

### Problem

`src/opensymphony-adapter.ts` has 5 pipeline stages that are all placeholders:
- `IntentStage`: logs prompt length, returns hardcoded type "bug_fix"
- `PlanningStage`: returns a hardcoded 6-step plan
- `ExecutionStage`: logs, returns empty
- `CollectionStage`: returns "No changes were made (placeholder stage)"
- `TasteStage`: counts how many stages succeeded

They never call OpenCode, never produce a diff, never create a PR.

### Solution

Replace each placeholder stage with real execution that flows through the existing `PipelineExecutor` and OpenCode dispatch machinery.

#### Stage Implementations

**IntentStage** (classify):
- Accept the raw prompt from the dispatch request
- Use a cheap model call (or heuristic classification) to determine:
  - Issue type: `bug_fix` | `feature_request` | `question` | `unknown`
  - Complexity estimate: `simple` | `medium` | `complex`
  - Key entities: repo owner, repo name, issue number (extracted from prompt)
- Output structured intent object

**PlanningStage** (approach):
- Take the intent output
- Generate a structured fix plan:
  - Steps to reproduce
  - Root cause hypothesis
  - Files likely affected
  - Approach description
- This can be LLM-generated or use a template-based approach for known patterns

**ExecutionStage** (actually run OpenCode):
- Calls `POST /api/run` on OpenCode serve (the same endpoint `dispatchToOpenCode` in `src/github/actionDispatcher.ts` calls)
- Constructs the prompt from issue context + plan
- Passes model, tool allowlist, timeout from pipeline config
- Returns: stdout, diff, branch name, test output
- Uses the existing `doFetchWithRetry` / `OpenCodeDispatchClient` infrastructure

**CollectionStage** (gather results):
- Parse OpenCode output into structured fields: diff, branch, test output, PR URL
- Run quality gates (if configured)
- Returns aggregated result object

**TasteStage** (assess quality):
- Evaluate: did tests pass? is there a real diff? quality gates pass?
- Assign confidence: `high` (all pass), `medium` (some issues), `low` (multiple failures)
- Returns confidence score + evidence

#### Entry Points

The `PipelineExecutor` in `src/pipeline/pipelineExecutor.ts` already has:
- Template resolution (`getLoadedTemplate`)
- Session creation (`createSession`)
- Phase step resolution (step-by-step through pre/main/post/final)
- Retry logic, budget tracking, loop detection, dead-end detection
- Progress querying (`getProgress`)

Wire the OpenSymphony adapter to actually use `PipelineExecutor`. When `handleRun` is called:
1. Parse the request (model, prompt)
2. Select pipeline template based on model prefix
3. Create a `PipelineExecutor` instance
4. Walk through phases: `start()` → `advance()` loop
5. Return the final result as OpenCode-compatible response

#### Pipeline Templates

- `fast`: intent → execute → taste (for simple fixes, cheaper)
- `full`: intent → plan → execute → collect → taste (for complex issues, thorough)
- Model prefix mapping: `haiku` → `fast`, `sonnet` → `full`, `opus` → `full`

#### Progress Events

Each stage should emit progress events that the Progress Publisher (from Ticket 2/3) can consume:
- `pipeline.started` — run_id, model, template
- `stage.started` — stage name
- `stage.completed` — stage name, duration, output summary
- `pipeline.completed` — final result, confidence, PR URL

#### Files to change

| File | Change |
|------|--------|
| `src/opensymphony-adapter.ts` | Replace stage implementations with real logic |
| `src/pipeline/pipelineExecutor.ts` | Add method to get execution result for stages |
| `src/pipeline/types.ts` | Add progress event types |
| `src/opencode-contract.ts` | Verify types match requirements |

#### Acceptance Criteria

- [ ] `POST /api/run` with a valid prompt returns a real result (not placeholder)
- [ ] `ExecutionStage` calls OpenCode serve and gets back a real response
- [ ] `TasteStage` correctly assesses confidence based on test results
- [ ] Pipeline templates (`fast`, `full`) selectable via model prefix
- [ ] Existing `PipelineExecutor` tests continue to pass
- [ ] Progress events emitted at each stage transition

---

## Ticket 2: Slack as a First-Class Channel

### Problem

Slack is currently in `src/notifications/` — it can **send** messages but is not a bidirectional channel like Telegram (`src/channels/telegram.ts`). Users cannot:
- Submit fix requests via Slack and get progress in the same thread
- Interact with STAS beyond the `/stas fix` command
- Get real-time streaming updates from the pipeline

### Solution

Move Slack into `src/channels/slack.ts` as a proper `ProgressSender`, matching the Telegram pattern.

#### SlackChannel implementation

Create `src/channels/slack.ts` that:
- Implements `ProgressSender` (sendProgress, sendMessage)
- Uses the Bolt app for receiving commands
- Uses `@slack/web-api` for posting messages

**Commands**:

| Command | Action |
|---------|--------|
| `/stas fix <description>` | Submit fix with default repo |
| `/stas fix <owner/repo> <description>` | Submit fix with explicit repo |
| `/stas status <run_id>` | Check status of a run |
| `/stas help` | Show available commands |

**Progress updates**:
When a pipeline run is triggered from Slack, STAS:
1. Posts an initial "Investigating..." message in the channel/thread
2. As pipeline stages complete, replies in the thread with updates
3. On completion, posts the final result with View PR / View Issue buttons
4. On failure, posts error details with retry suggestion

**Channel registration**:
- Register Slack as a channel in `src/channels/index.ts`
- Wire the channel target (Slack channel ID + thread_ts) through the pipeline
- Progress Publisher sends updates to the originating Slack thread

#### Integration with Pipeline (Ticket 1)

When a request comes from Slack:
1. Parse `/stas fix <description>` → extract issue title/body
2. Create a pipeline run via the Unified Event Router (or directly)
3. The run carries `channel: 'slack'` and `channelTarget: 'C12345:thread_ts'`
4. As stages complete, the Progress Publisher calls `SlackProgressSender.sendProgress()`

#### Files to change

| File | Change |
|------|--------|
| `src/channels/slack.ts` | **Create** — new channel implementing ProgressSender |
| `src/channels/index.ts` | Export Slack channel |
| `src/notifications/slack.ts` | Keep for backward compat, delegate to channel |
| `src/notifications/slack-bolt.ts` | Add command handlers for /stas status, /stas help |
| `src/server.ts` | Mount Bolt receiver properly |
| `src/config.ts` | Verify Slack env vars are complete |

#### Acceptance Criteria

- [ ] `/stas fix <description>` creates a pipeline run and posts initial response
- [ ] Progress updates appear as thread replies (investigating→fixing→testing→PR)
- [ ] `/stas status <run_id>` returns current pipeline state
- [ ] View PR / View Issue buttons work
- [ ] Works in both DMs and group channels
- [ ] All existing notification tests pass

---

## Ticket 3: MCP Server Backed by Real Pipeline

### Problem

The Python MCP server (`stas_mcp/server.py`) is standalone:
- `run_fix` writes to a JSON file registry at `/tmp/stas-fix-registry.json`
- `_enqueue_fix_via_internal` tries to POST to an internal queue that typically isn't running
- The registry is ephemeral — survives only in process memory
- No real execution ever happens

### Solution

Replace the JSON registry with HTTP calls to the STAS internal API, which routes through the OpenSymphony pipeline.

#### Architecture

```
MCP Client (AI Agent)
       │
       │ tools/call { name: "stas_run_fix", args: { issue_url } }
       ▼
Python FastMCP Server (stas_mcp/server.py)
       │
       │ POST /api/fix { issue_url, source: "mcp" }
       ▼
STAS Express API (src/routes/fix.ts)
       │
       │ Create pipeline run via PipelineExecutor
       ▼
OpenSymphony Pipeline (Ticket 1)
       │
       │ Result: PR URL, status
       ▼
Python FastMCP Server
       │
       │ Response to client
       ▼
MCP Client receives result
```

#### Changes to `stas_mcp/`

**handlers.py** — Replace `_fix_registry` (JSON file) with API calls:
- `run_fix(issue_url)` → POST to `{STAS_API_URL}/api/fix` → returns `{ run_id, status }`
- `check_status(run_id)` → GET `{STAS_API_URL}/api/fix/{run_id}` → returns status + result
- `get_pr(run_id)` → GET `{STAS_API_URL}/api/fix/{run_id}/pr` → returns PR URL
- `label_issue(...)` → stays as direct GitHub API call (no pipeline needed)
- Remove `_load_registry`, `_save_registry`, `_fix_registry`
- Remove `_enqueue_fix_via_internal`

**New MCP tools**:

| Tool | Description |
|------|-------------|
| `stas_submit_ticket` | Submit full ticket (repo, title, body, labels) |
| `stas_stream_progress` | SSE endpoint URL for real-time updates |
| `stas_get_fix_result` | Structured result: diff, test output, PR URL, confidence |

**Resources**:
- `stas://runs/{run_id}` — live data from pipeline (not JSON file)
- `stas://issues/{issue_id}` — aggregated issue history across runs

#### Changes to `src/`

**New endpoint**: `POST /api/fix`
- Receives `{ issue_url?, repoOwner, repoName, issueTitle, issueBody, source }`
- Creates a pipeline run via `PipelineExecutor`
- Returns `{ run_id, status, poll_url }`

**New endpoint**: `GET /api/fix/{runId}`
- Returns current pipeline status + result (if completed)
- Includes: status, stage, progress%, PR URL, diff, test output, confidence

**New endpoint**: `GET /api/fix/{runId}/stream`
- SSE endpoint that streams progress events as they happen
- Events: `pipeline.started`, `stage.started`, `stage.completed`, `pipeline.completed`, `pipeline.failed`

**New endpoint**: `POST /api/fix/{runId}/retry`
- Retry a failed pipeline run with same parameters

#### Files to change

| File | Change |
|------|--------|
| `stas_mcp/handlers.py` | Replace JSON registry with STAS API calls |
| `stas_mcp/server.py` | Add new tools (submit_ticket, stream_progress) |
| `src/routes/fix.ts` | **Create** — fix API routes |
| `src/server.ts` | Mount fix routes |
| `src/mcp.ts` | Update discovery endpoint with new tools |
| `stas/mcp-server.json` | Update manifest with new tools |

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_API_URL` | `http://localhost:3000` | Base URL of STAS API for MCP to call |

#### Acceptance Criteria

- [ ] `stas_run_fix` creates a real pipeline run (no JSON file)
- [ ] `stas_check_status` returns live pipeline state
- [ ] `stas_get_pr` returns PR URL after pipeline completes
- [ ] `POST /api/fix` creates pipeline runs from any source
- [ ] `GET /api/fix/{runId}/stream` emits real-time SSE events
- [ ] MCP server works in both SSE and stdio modes
- [ ] All existing MCP tests pass

---

## Ticket 4: STAS as OpenCode Skills

### Problem

STAS has skill markdown files (`stas/skill.md`, `skills/stas/skill.md`) but they are:
- Static documentation — an AI reads them and implements the described behavior manually
- Not registered as downloadable OpenCode skills
- No auto-discovery — users must manually configure

### Solution

Publish STAS as proper OpenCode skill(s) that agents can install and use directly.

#### Skill Definition

Create a proper OpenCode skill manifest that defines:

**Tools** (what the skill exposes to agents):
- `stas_submit_fix(repoUrl, issueTitle, issueBody, issueNumber)` — submit issue for fix
- `stas_poll_job(jobId)` — poll for completion
- `stas_list_jobs(status?, limit?)` — list recent fix jobs

**Configuration**:
- `STAS_API_KEY` — API key for the STAS cloud service
- `STAS_API_URL` — STAS API base URL (default: `https://api.stas.aimino.io`)
- `GITHUB_TOKEN` — optional, for self-hosted

**Auto-discovery**:
- The skill registers with OpenCode's serve endpoint
- When OpenCode starts, it discovers STAS as a connected service
- Users can say "fix this issue" without manual setup

#### Skill Package

Create a proper npm package (`@aimino/stas-skill` or similar) that:
1. Contains the skill manifest
2. Can be installed via `npx` or `npm install`
3. Registers tools that call the STAS API (same pipeline from Ticket 3)

**Installation for users**:
```bash
# Option 1: OpenCode config
echo '{"skills": ["@aimino/stas-skill"]}' >> opencode.json

# Option 2: CLI
npx stas skill init
```

**Usage in OpenCode**:
```
User: "Fix the login bug in issue #42"
Agent: [uses stas_submit_fix tool] → [polls stas_poll_job] → "Created PR #43"
```

#### Files to change

| File | Change |
|------|--------|
| `skils/stas/skill.md` | Update with actual tool definitions |
| `stas/skill.md` | Update to match |
| `skils/stas/package.json` | **Create** — npm package manifest |
| `skils/stas/tools/` | **Create** — tool implementations |
| `stas/mcp-server.json` | Add OpenCode skill section |
| `package.json` | Add `@slack/bolt` and MCP deps if missing |

#### Smithery + OpenCode Registry

- The MCP server is already on Smithery (`@aimino/stas-mcp`)
- Add OpenCode skill to the OpenCode skills registry
- Cross-reference: MCP for general AI agents, Skills for OpenCode agents

#### Acceptance Criteria

- [ ] `stas_submit_fix` tool works in any OpenCode agent
- [ ] Skill auto-discovers when OpenCode starts
- [ ] `npx stas skill init` generates valid config
- [ ] Skill works with both cloud and self-hosted STAS

---

## Unified Event Router (cross-cutting)

### Problem

Currently each entry point (GitHub webhook, Slack, MCP, worker) has its own logic for parsing input, creating jobs, and handling results. This means 4 different paths through the system.

### Solution

Create a lightweight **Unified Event Router** that all entry points call.

**Interface**:
```typescript
interface FixRequest {
  source: 'github' | 'slack' | 'mcp' | 'skill';
  repoOwner: string;
  repoName: string;
  issueNumber?: number;
  issueTitle: string;
  issueBody?: string;
  labels?: string[];
  channel?: 'slack' | 'telegram' | 'whatsapp';
  channelTarget?: string; // Slack channel ID, Telegram chat ID, etc.
}
```

**Behavior**:
1. Normalize input from any source → `FixRequest`
2. Call `PipelineExecutor.start()` to begin the pipeline
3. Return `{ runId, status, pollUrl }` immediately
4. When pipeline advances, call the appropriate ProgressSender for `channel`

**Integration points**:
- GitHub webhook handler (`src/webhooks/github.ts`) → Router
- Slack command handler (`src/channels/slack.ts`) → Router
- MCP `POST /api/fix` → Router
- Worker from queue → Router

## Progress Publisher (cross-cutting)

### Problem

No single mechanism for broadcasting pipeline progress to the originating channel.

### Solution

Unified `ProgressPublisher` that routes events to the right channel.

```typescript
interface ProgressPublisher {
  publish(event: ProgressEvent): Promise<void>;
}

interface ProgressEvent {
  runId: string;
  stage: string;
  status: 'started' | 'completed' | 'failed';
  message: string;
  detail?: string;
  progress?: number; // 0-100
  prUrl?: string;
  timestamp: string;
}
```

**Channel implementations**:
- `SlackProgressPublisher` — posts thread replies
- `GitHubProgressPublisher` — posts issue comments
- `MCPProgressPublisher` — updates SSE stream + resource

## Future Scope: Multi-Platform Expansion

The OpenSymphony pipeline architecture is designed to accept requests from any source through the Unified Event Router. Planned expansions:

- **Bitbucket**: Webhook integration, PR creation via Bitbucket API
- **Jira**: Ticket polling, branch creation, PR/MR creation
- **GitLab**: Already partially supported in `src/webhooks/gitlab.ts`
- **Linear**: Webhook integration (already has `src/webhooks/linear.ts`)

Each new platform adds:
1. A new webhook handler in `src/webhooks/`
2. A new API client in `src/platforms/`
3. Registration in the Unified Event Router

The pipeline, progress publisher, and delivery channels (Slack, MCP) remain unchanged — the platform is just an input source.

## Order of Implementation

1. **Ticket 1**: Real OpenSymphony pipeline — core, everything else depends on it
2. **Ticket 2**: Slack as a channel — highest user-facing impact
3. **Ticket 3**: MCP backed by pipeline — enables AI agent ecosystem
4. **Ticket 4**: OpenCode skills — broadest reach

Each ticket is independently testable and shippable. The later tickets depend on the pipeline from Ticket 1 being real.
