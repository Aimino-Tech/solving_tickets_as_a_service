# OpenCode Contract — STAS ↔ OpenCode Serve

**Status**: Living document — update if the API surface, prompt structure, or dispatch logic changes.

## Overview

STAS does not implement its own fix agent. Instead, it delegates the entire
investigate–fix–verify cycle to **OpenCode Serve**, a purpose-built AGI agent
harness running at a local HTTP endpoint.

This document defines the contract between STAS (the orchestrator) and OpenCode
Serve (the code-writing agent).

---

## 1. Transport

| Property | Value |
|---|---|
| Method | `POST` |
| URL | `config.opencode.url` `/api/run` (default `http://localhost:4096`) |
| Auth | `Authorization: Bearer <github-installation-token>` |
| Content-Type | `application/json` |

The installation token is obtained via `getInstallationToken(installationId)`
and scoped to a single repo.

---

## 2. Request Body

```typescript
{
  prompt: string;   // see §3 — the full system+user prompt
  model: string;    // model identifier, e.g. "anthropic/claude-sonnet-4-20250514"
}
```

### Model Chain

A primary model and an ordered list of fallback models are configured via env
vars `OPENCODE_MODEL` and `FALLBACK_MODELS`.  dispatchToOpenCode() iterates
through the chain on failure:

```
for (model of [primary, ...fallbacks]) {
  try { POST /api/run with model }
  catch/error → retry with next model
}
```

If the primary fails (HTTP error, timeout, or network error), STAS posts a
status comment notifying which model it is falling back to. If every model in
the chain fails, the issue is handled by the `attemptBasicFix()` fallback which
uses the cheap OpenAI model with structured tool calls directly.

Default chain:
- Primary: `anthropic/claude-sonnet-4-20250514`
- Fallbacks: `gpt-4o`, `claude-haiku`

### Timeout

Each call is wrapped in `withTimeout(promise, config.phaseTimeouts.openCodeAgent, ...)`.
The default timeout for the OpenCode agent phase is **10 minutes** (600,000 ms).
If the server does not respond within this window, STAS moves to the next
fallback model.

---

## 3. Prompt Structure

STAS builds the prompt in `buildOpenCodePrompt()`. The prompt is a single
Markdown string composed of these sections:

### Identity & Context
```
# STAS Fix Agent
You are an autonomous fix agent for **{repoOwner}/{repoName}**.
Your task is to investigate the following issue, implement a fix,
write a regression test, and commit the changes to a branch.
```

### Issue
```
## Issue
**#{issueNumber}: {issueTitle}**
{issueBody}
```

### Issue Comments
```
## Issue Comments
> @commenter: comment body
...
```

Up to 15 comments (config `MAX_ISSUE_COMMENTS`), each prefixed with `> @user:`.

### Triage Analysis
```
## Triage Analysis
**Type**: {triage.type}         // bug | feature | question | unknown
**Difficulty**: {triage.difficulty}  // easy | medium | hard | unknown
**Summary**: {triage.summary}
**Relevant Files**:
- path/to/file.ts
...
```

### Baseline Test Results (optional)
```
## Baseline Test Results
**Status**: PASSED | FAILED
**Duration**: {durationMs}ms
**Command**: `{command}`
```

If baseline tests were already failing, an additional warning is appended.

### Static Analysis Output (optional)
```
## Static Analysis Output
```
{analysisResult (truncated to 2000 chars)}
```

### Codebase Structure (optional)
```
## Codebase Structure
```
{codeIntel.fileStructure (truncated to 3000 chars)}
```

### Instructions
```
## Instructions
1. **Reproduce** — Understand the issue and reproduce it if possible.
2. **Trace** — Find the root cause by tracing the code path.
3. **Fix** — Implement the minimal fix needed.
4. **Regression Test (MANDATORY)** — Write a regression test that:
   a. Tests the specific bug scenario described in the issue
   b. **Must fail** when run against the original (unfixed) code
   c. **Must pass** when run against your fix
   d. Place the test in the existing test directory following project conventions
5. **Verify** — Run the existing test suite to ensure nothing is broken.
6. **Format** — Format modified files per project conventions.
7. **Commit** — Stage all changes and commit with a descriptive message.
```

### Tools Available
```
## Tools Available
- read_file
- write_file
- patch_file
- replace_lines
- search_codebase
- find_files
- run_command
- run_tests
- get_diff
- format_code
- list_directory
- get_line_numbers
- find_symbol
- trace_imports
- submit_fix
```

### Rules
```
## Rules
- Use `run_command` to clone and work with the repo.
- The repo is already cloned — work in the current directory.
- After implementing the fix and verifying, use `submit_fix`
  with a branch name like `stas/fix-${issueNumber}-<short-hash>`.
- Include your summary, confidence level, and test results in the final output.
- If you cannot fix the issue, clearly explain why.
```

### Output Format Directive
```
## Output Format
When done, output a JSON summary:
{
  "summary": "What was done",
  "confidence": "high|medium|low",
  "diff": "optional unified diff of changes",
  "branch": "optional branch name if pushed",
  "testOutput": "optional test run output",
  "errors": ["optional list of errors"]
}
```

---

## 4. Response Contract

### Success (HTTP 2xx)

The response body is parsed as JSON:

```typescript
{
  summary: string;                    // Human-readable description of work done
  confidence: "high" | "medium" | "low";
  diff?: string;                      // Unified diff of all changes
  branch?: string;                    // Branch name if changes were pushed
  testOutput?: string;                // Test run output if tests were executed
  errors?: string[];                  // Non-fatal warnings or partial failures
  metadata?: Record<string, unknown>; // Optional structured metadata
}
```

### Failure (non-2xx or error)

If OpenCode returns a non-2xx status or the request itself fails (network,
timeout), STAS:

1. Stores the error text as `lastError`
2. Posts a status comment on the issue notifying of the fallback
3. Retries with the next model in the chain
4. If all models are exhausted, returns `{ success: false, ... }`
5. STAS then falls through to `attemptBasicFix()` — a simpler fix loop using
   the OpenAI SDK directly with the cheap model (`OPENAI_CHEAP_MODEL`, default
   `gpt-4o-mini`)

### Special: Prompt Injection Protection

Before sending, the prompt is run through `sanitizeUserContent()` which
redacts known instruction-override patterns:
- "ignore all previous instructions"
- "you are not..."
- "forget everything"
- "system override"
- "you must now..."
- etc.

Issue body and comments (user-supplied content) are embedded in the prompt
and are the primary injection surface.

---

## 5. Architecture Diagram

```
GitHub Issue (labeled "stas:fix")
       │
       ▼
  Webhook Receiver (Express)
       │
       ├── Verify webhook signature
       ├── Post "working on it" comment
       ├── Build job → BullMQ queue
       │
       ▼
  issueAgent.ts (worker)
       │
       ├── Phase 1: Triage (cheap OpenAI model)
       │   └── classifyIssue() → {type, difficulty, relevantFiles}
       │
       ├── Phase 2: Fetch issue comments
       │
       ├── Phase 3: Boot E2B sandbox
       │
       ├── Phase 3.5: Baseline test suite
       │
       ├── Phase 4: Static analysis (tsc --noEmit etc.)
       │
       ├── Phase 5: Code intelligence (symbols, imports, file tree)
       │
       ├── Phase 6: OpenCode Serve  ◄── THIS CONTRACT
       │   │
       │   ├── POST /api/run  ──►  OpenCode Serve (:4096)
       │   │                         ├── Clone repo (shallow)
       │   │                         ├── Investigate root cause
       │   │                         ├── Write fix + regression test
       │   │                         ├── Run existing test suite
       │   │                         ├── Commit & push branch
       │   │                         └── Return JSON result
       │   │
       │   └── fallback → attemptBasicFix() using cheap OpenAI model
       │
       ├── Phase 6.5: Verification (regression test validation)
       │
       ├── Phase 7: ActionDispatcher → PR creation
       │
       └── Phase 8: Sandbox cleanup
```

---

## 6. Configuration Reference

| Env Var | Default | Description |
|---|---|---|
| `OPENCODE_URL` | `http://localhost:4096` | Base URL of OpenCode serve |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Primary model for fix agent |
| `FALLBACK_MODELS` | `gpt-4o,claude-haiku` | Comma-separated fallback models |
| `OPENAI_CHEAP_MODEL` | `gpt-4o-mini` | Model used for triage + fallback fix |
| `PHASE_TIMEOUT_OPENCODE_AGENT` | `600000` (10 min) | Max time to wait for OpenCode per model |

---

## 7. Key Files

| File | Role |
|---|---|
| `src/agent/issueAgent.ts` | Orchestrator — builds prompt, calls OpenCode, handles fallback |
| `src/agent/types.ts` | `AgentResult`, `VerificationResult`, `TriageResult` type definitions |
| `src/agent/receipts.ts` | Receipt manifest for audit trail |
| `src/config.ts` | `opencode` config section (url, model, fallbackModels) |
| `src/github/actionDispatcher.ts` | Post-agent — creates PR, posts result comment |
| `src/sandbox/executor.ts` | E2B sandbox — repo clone, test runner, static analysis |
