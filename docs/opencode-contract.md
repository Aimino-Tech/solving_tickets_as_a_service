# OpenCode Contract — SYNTARO ↔ OpenCode Serve

> **Document**: AIM-1927 — Formal contract definition between SYNTARO and OpenCode serve.
> **Version**: 1.0.0
> **Last Updated**: 2026-06-24

---

## Table of Contents

1. [Overview](#1-overview)
2. [Transport Protocol](#2-transport-protocol)
3. [Request Payload (SYNTARO → OpenCode)](#3-request-payload-syntaro--opencode)
4. [Response Payload (OpenCode → SYNTARO)](#4-response-payload-opencode--syntaro)
5. [Environment Variables Injected by SYNTARO](#5-environment-variables-injected-by-syntaro)
6. [Workspace Layout](#6-workspace-layout)
7. [Tools Available to OpenCode](#7-tools-available-to-opencode)
8. [Progress Reporting (OpenCode → SYNTARO)](#8-progress-reporting-opencode--syntaro)
9. [Error Handling](#9-error-handling)
10. [Model Chaining and Fallback](#10-model-chaining-and-fallback)
11. [Timeout and Circuit Breaker](#11-timeout-and-circuit-breaker)
12. [Contract Versioning](#12-contract-versioning)
13. [Zod Validation Schemas](#13-zod-validation-schemas)
14. [TypeScript Interfaces](#14-typescript-interfaces)

---

## 1. Overview

SYNTARO dispatches fix-generation work to OpenCode serve — an HTTP server running on `http://localhost:4096` (configurable via `OPENCODE_URL`). This document defines the formal contract between the two systems.

**Key principle**: SYNTARO owns the orchestration pipeline (triage, sandboxing, verification, PR creation). OpenCode owns the investigation and fix-generation loop. They communicate over HTTP with a JSON request/response protocol.

### Architecture Diagram

```
+-------------------------------------------+
|  SYNTARO Agent Pipeline                      |
|                                           |
|  Phase 1-5: Triage, comments, sandbox,    |
|             analysis                       |
|         |                                 |
|         v                                 |
|  Phase 6: dispatchToOpenCode()            |
|         |                                 |
|         v                                 |
|  POST /api/run +--------------------------+
|  { prompt, model }                        |
|         |                                 |
|         v                                 |
|  OpenCode Serve (:4096)                   |
|         |                                 |
|         +-- Investigate root cause        |
|         +-- Write fix + regression test   |
|         +-- Run test suite                |
|         +-- Commit & push branch          |
|         |                                 |
|         v                                 |
|  Response: { summary, confidence, diff,   |
|              branch, testOutput, errors }  |
|         |                                 |
|         v                                 |
|  Phase 6.5-8: Verification, PR creation   |
+-------------------------------------------+
```

---

## 2. Transport Protocol

| Property | Value |
|----------|-------|
| **Protocol** | HTTP/1.1 |
| **Method** | `POST` |
| **Endpoint** | `/api/run` |
| **Content-Type** | `application/json` |
| **Encoding** | UTF-8 |
| **Authentication** | Bearer token (`Authorization: Bearer <installationToken>`) |
| **Timeout** | 600,000 ms (10 min, configurable via `FIX_TIMEOUT_MS`) |
| **Connection** | Keep-Alive preferred |

### Endpoint URL

```
POST {OPENCODE_URL}/api/run
```

Where `OPENCODE_URL` defaults to `http://localhost:4096`.

### Authentication

Every request includes a GitHub Installation Access Token in the `Authorization` header:

```
Authorization: Bearer <github_installation_token>
```

This token is obtained by SYNTARO via `getInstallationToken(installationId)` and allows OpenCode to push branches and interact with the target repository.

---

## 3. Request Payload (SYNTARO → OpenCode)

```typescript
interface OpenCodeRequest {
  /** The system prompt instructing OpenCode what to do.
   *  Built by buildOpenCodePrompt() — includes issue context,
   *  triage analysis, code structure, and instructions. */
  prompt: string;

  /** The model identifier to use.
   *  Format: "<provider>/<model-name>"
   *  Examples: "anthropic/claude-sonnet-4-20250514", "gpt-4o" */
  model: string;
}
```

### Raw JSON Wire Format

```json
{
  "prompt": "# SYNTARO Fix Agent\n\nYou are an autonomous fix agent...",
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

### How the Prompt Is Built

The prompt is constructed by `buildOpenCodePrompt()` in `src/agent/issueAgent.ts`. It includes:

1. **Issue context**: title, body, comments (up to 15)
2. **Triage classification**: type (bug/feature/question), difficulty, relevant files
3. **Baseline test results**: pass/fail status, output, duration
4. **Static analysis output**: from `sandbox.analyzeCode()`
5. **Codebase structure**: file tree listing
6. **Instructions**: detailed steps (reproduce, trace, fix, write regression test, verify, format, commit)
7. **Tools available**: list of allowed tools
8. **Rules**: branch naming, output format, quality requirements
9. **Output format spec**: JSON schema for the response

### Prompt Injection Protection

Before sending, the prompt is sanitized via `sanitizeUserContent()` which redacts:
- `ignore all previous instructions`
- `ignore all prior instructions`
- `you are not`
- `forget everything`
- `your new role`
- `disregard`
- `system override`
- `you must now`
- `you are now`

---

## 4. Response Payload (OpenCode → SYNTARO)

```typescript
interface OpenCodeResponse {
  /** Summary of what was done by the agent. */
  summary: string;

  /** Confidence level in the fix correctness. */
  confidence: 'high' | 'medium' | 'low';

  /** Optional unified diff of all changes made. */
  diff?: string;

  /** Branch name if changes were pushed to remote. */
  branch?: string;

  /** Output from running the test suite post-fix. */
  testOutput?: string;

  /** List of error messages if something went wrong. */
  errors?: string[];

  /** Arbitrary metadata from the agent run. */
  metadata?: Record<string, unknown>;
}
```

### Raw JSON Wire Format

**Success response:**
```json
{
  "summary": "Fixed the login validation bug by adding email sanitization to the auth controller.",
  "confidence": "high",
  "diff": "diff --git a/src/auth/login.ts b/src/auth/login.ts\n...",
  "branch": "syntaro/fix-42-a1b2c3d",
  "testOutput": "PASS  tests/auth/login.test.ts (12ms)\n  ✓ handles valid email\n  ✓ rejects special characters\nTests: 2 passed, 2 total",
  "errors": []
}
```

**Failure response:**
```json
{
  "summary": "Unable to reproduce or fix the issue.",
  "confidence": "low",
  "errors": [
    "Could not find the root cause in the codebase",
    "The issue references a file that does not exist"
  ]
}
```

### Response Parsing Logic (SYNTARO side)

In `dispatchToOpenCode()`, the response is parsed as follows:

```typescript
const result = (await response.json()) as Record<string, unknown>;

const summary = String(result.summary || 'Agent completed.');
const diff = result.diff ? String(result.diff) : undefined;
const branchName = result.branch ? String(result.branch) : undefined;
const testOutput = result.testOutput ? String(result.testOutput) : undefined;
const confidence = parseConfidence(result);
// confidence maps: 'high' | 'medium' | 'low' — defaults to 'medium'
const errorList = result.errors ? (result.errors as string[]) : undefined;
```

### Status Codes

| HTTP Status | Meaning | SYNTARO Handling |
|-------------|---------|---------------|
| `200 OK` | Success | Parse response JSON, proceed to verification |
| `400 Bad Request` | Malformed payload | Log error, try fallback model |
| `401 Unauthorized` | Invalid/expired token | Log error, fail with auth error |
| `429 Too Many Requests` | Rate limited | Retry with backoff |
| `500 Internal Server Error` | OpenCode crash | Log error, try fallback model |
| `503 Service Unavailable` | OpenCode overloaded | Retry with backoff |
| Any non-2xx | General failure | Try next model in chain or fail |

---

## 5. Environment Variables Injected by SYNTARO

The following environment variables are consumed by the SYNTARO process that calls OpenCode. These are **not** forwarded to OpenCode serve directly; OpenCode runs as a separate process. The prompt conveys equivalent context.

| Variable | Default | Description | Used In |
|----------|---------|-------------|---------|
| `OPENCODE_URL` | `http://localhost:4096` | OpenCode serve endpoint | `dispatchToOpenCode()` |
| `OPENCODE_API_KEY` | — | Optional API key for OpenCode | Request headers (not currently used) |
| `OPENCODE_MODEL` | `anthropic/claude-sonnet-4-20250514` | Primary model identifier | Request payload `model` field |
| `FALLBACK_MODELS` | `gpt-4o,claude-haiku` | Comma-separated fallback models | Model chain iteration |
| `FIX_TIMEOUT_MS` | `600000` | Max time for fix generation (10 min) | `withTimeout()` wrapper |
| `PHASE_TIMEOUT_TRIAGE_MS` | `30000` | Timeout for triage phase | n/a for OpenCode |
| `PHASE_TIMEOUT_SANDBOX_MS` | `300000` | Timeout for sandbox boot | n/a for OpenCode |
| `PHASE_TIMEOUT_PRCREATION_MS` | `30000` | Timeout for PR creation | n/a for OpenCode |
| `MAX_AGENT_ITERATIONS` | `40` | Max iterations for agent loop | n/a for OpenCode |
| `MAX_ISSUE_COMMENTS` | `15` | Max issue comments to include | Prompt building |
| `SYNTARO_LABEL` | `syntaro:fix` | Issue label that triggers SYNTARO | Webhook trigger (not OpenCode) |
| `E2B_API_KEY` | — | Sandbox API key | Sandbox (not OpenCode) |
| `DOCKER_IMAGE` | `node:22-alpine` | Sandbox Docker image | Sandbox (not OpenCode) |

---

## 6. Workspace Layout

The workspace layout is defined by the sandbox (E2B or Docker), which is booted **before** the OpenCode call. OpenCode operates inside the sandbox's cloned repository.

```
<workspace>/
+-- <repository>/
|   +-- .git/
|   +-- src/
|   +-- tests/
|   +-- package.json (or equivalent)
|   +-- ...
+-- (sandbox temporary files)
```

### Sandbox Lifecycle (relative to OpenCode call)

```
1. createSandbox(repoUrl, ...)
2. sandbox.boot()
   +-- Create container/instance
   +-- Clone repository (shallow, depth=1)
   +-- Detect runtime
   +-- Install dependencies
3. sandbox.analyzeCode()        <- Phase 4: static analysis
4. dispatchToOpenCode(prompt)   <- Phase 6: OpenCode works inside sandbox
5. sandbox.runTests()           <- Phase 6.5: verification
6. sandbox.destroy()            <- Phase 8: cleanup
```

### Branch Naming Convention

OpenCode is instructed to push branches named:
```
syntaro/fix-${issueNumber}-<short-hash>
```

Example: `syntaro/fix-42-a1b2c3d`

---

## 7. Tools Available to OpenCode

The prompt tells OpenCode which tools it has access to. This is advisory — actual tool availability depends on the OpenCode serve implementation.

| Tool | Description |
|------|-------------|
| `read_file` | Read a file from the sandbox |
| `write_file` | Write content to a file |
| `patch_file` | Apply a patch to a file |
| `replace_lines` | Replace specific lines in a file |
| `search_codebase` | Search for patterns in code |
| `find_files` | Find files by glob pattern |
| `run_command` | Execute an arbitrary shell command |
| `run_tests` | Run the project test suite |
| `get_diff` | Get the current git diff |
| `format_code` | Format code per project conventions |
| `list_directory` | List contents of a directory |
| `get_line_numbers` | Get line numbers for a symbol |
| `find_symbol` | Find symbol definitions across the codebase |
| `trace_imports` | Trace import chains in the codebase |
| `submit_fix` | Finalize fix, create branch, push, return result |

---

## 8. Progress Reporting (OpenCode → SYNTARO)

Currently, **OpenCode serve does not stream progress back to SYNTARO**. The request is a single HTTP POST that blocks until completion. SYNTARO handles this by:

1. **Posting status comments** to the GitHub issue before calling OpenCode:
   - "Running fix agent — investigating root cause and writing fix (may take a few minutes)."

2. **Timeout enforcement** via `withTimeout()`:
   ```typescript
   const result = await withTimeout(
     dispatchToOpenCode(params),
     config.phaseTimeouts.openCodeAgent,  // default: 10 min
     '6-opencode-agent',
   );
   ```

3. **Model fallback chain**: if the primary model fails/timeouts, subsequent models are tried with status updates posted to the issue.

### Future: Streaming / SSE

For future iterations, the contract could be extended to support Server-Sent Events (SSE) for real-time progress:

```
GET /api/run/stream?requestId=<id>
-> SSE stream of progress updates (phase, message, percent)
```

This is **not implemented** in the current contract.

---

## 9. Error Handling

### Request-level Errors

| Scenario | SYNTARO Behavior |
|----------|---------------|
| HTTP non-2xx response | Try next model in fallback chain |
| Network timeout / `fetch` error | Try next model; distinguish timeout from crash |
| Malformed response JSON | Try next model |
| Missing required fields | Try next model |
| All models exhausted | Return `{ success: false, errors: [lastError] }` |
| Circuit breaker open | Throw immediately, skip all models |
| Phase timeout (10 min) | Return timeout error, try fallback `attemptBasicFix()` |

### Response-level Errors (in the response JSON)

| Condition | Parsing Behavior |
|-----------|------------------|
| `summary` missing | Default to `'Agent completed.'` |
| `confidence` missing/invalid | Default to `'medium'` |
| `diff` missing | Set to `undefined` (no diff available) |
| `branch` missing | Set to `undefined` (branch not pushed) |
| `errors` array present | Pass through to agent result |

### Fallback Strategy

When OpenCode fails on all models:

```typescript
// In issueAgent.ts Phase 6:
if (!openCodeResult.success) {
  // Try basic fix approach as fallback
  const fallbackResult = await attemptBasicFix(sandbox, data, triage, comments);
  return fallbackResult;
}
```

The `attemptBasicFix()` fallback uses the OpenAI SDK directly with a cheap model (`gpt-4o-mini`) and sandbox tools.

### Circuit Breaker

The bridge's circuit breaker is **not** wired to OpenCode calls (it applies to RabbitMQ bridge operations only). OpenCode calls use direct `fetch()` with a simple retry/try-next-model pattern.

---

## 10. Model Chaining and Fallback

The model selection follows a chain-of-fallback pattern:

```typescript
const models = [config.opencode.model, ...config.opencode.fallbackModels];
// Example: ["anthropic/claude-sonnet-4-20250514", "gpt-4o", "claude-haiku"]
```

For each model:
1. Post status update to issue (for fallback attempts after the first)
2. Send `POST /api/run` with `{ prompt, model }`
3. If `response.ok` -> parse and return result
4. If not `response.ok` -> log error, post fallback comment, try next model
5. If all fail -> return `{ success: false, errors: [...] }`

### Model Configuration

```typescript
// From config.ts
config.opencode = {
  url: env.OPENCODE_URL,              // "http://localhost:4096"
  apiKey: env.OPENCODE_API_KEY,        // optional
  model: env.OPENCODE_MODEL,           // "anthropic/claude-sonnet-4-20250514"
  fallbackModels: env.FALLBACK_MODELS.split(','),  // ["gpt-4o", "claude-haiku"]
};
```

---

## 11. Timeout and Circuit Breaker

### OpenCode-specific Timeout

```typescript
// Default: 600,000ms (10 minutes)
const openCodeTimeout = config.phaseTimeouts.openCodeAgent; // = config.fixTimeoutMs
```

The `withTimeout()` helper uses `AbortController` to enforce the timeout:

```typescript
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, phase: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new PhaseTimeoutError(phase, timeoutMs));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

### Circuit Breaker (not applied to OpenCode)

The `CrossServiceBridge` circuit breaker applies only to RabbitMQ operations. OpenCode HTTP calls use a simpler retry/try-next-model approach. The circuit breaker is present in the bridge for cross-service (Node.js <-> Python worker) calls.

---

## 12. Contract Versioning

This contract uses semantic versioning.

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-06-24 | Initial contract definition |

The schema version is tracked via the `CONTRACT_VERSION` constant in `src/bridge/contract.ts`.

---

## 13. Zod Validation Schemas

Full Zod schemas are defined in `src/bridge/contract.ts`. They validate:

### Request Schema (`OpenCodeRequestSchema`)
- `prompt`: non-empty string, max 100,000 chars
- `model`: non-empty string matching `<provider>/<model>` pattern

### Response Schema (`OpenCodeResponseSchema`)
- `summary`: string (required), max 10,000 chars
- `confidence`: enum `high | medium | low` (required)
- `diff`: optional string
- `branch`: optional string matching `syntaro/fix-\d+-[a-f0-9]+` pattern
- `testOutput`: optional string
- `errors`: optional array of strings
- `metadata`: optional record

### Validation Entry Points

Validation happens at the SYNTARO->OpenCode boundary:
1. **Before sending**: validate the request payload
2. **After receiving**: validate the response payload
3. **Both sides**: `OpenCodeContract.validateRequest()` / `OpenCodeContract.validateResponse()`

---

## 14. TypeScript Interfaces

Full TypeScript types are defined in `src/bridge/contract.ts`:

```typescript
// Request
interface OpenCodeRequest {
  prompt: string;
  model: string;
}

// Response
interface OpenCodeResponse {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  diff?: string;
  branch?: string;
  testOutput?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

// Validation result
interface ContractValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

// Contract class with static methods
class OpenCodeContract {
  static readonly VERSION = '1.0.0';
  static validateRequest(data: unknown): ContractValidationResult<OpenCodeRequest>;
  static validateResponse(data: unknown): ContractValidationResult<OpenCodeResponse>;
}
```

---

## References

- `src/agent/issueAgent.ts` -- OpenCode dispatch implementation (`dispatchToOpenCode()`, `buildOpenCodePrompt()`)
- `src/bridge/contract.ts` -- TypeScript types and Zod validation schemas
- `src/config.ts` -- Environment variable configuration
- `src/agent/types.ts` -- Agent result types (`AgentResult`, `OpenCodeDispatchResult`)
- `src/bridge/types.ts` -- Cross-service bridge message types
- `src/bridge/errors.ts` -- Error envelope definitions
- `WORKFLOW.md` -- OpenCode agent workflow (Sisyphus) state transitions
