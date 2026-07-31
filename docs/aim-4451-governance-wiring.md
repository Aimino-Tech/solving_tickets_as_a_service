# AIM-4451 — Wire Governance Proxy into Dispatch Path + Propagate x-trace-id

## Context

AIM-4241 / AIM-4243 were marked Verified but the core claims are FALSE at HEAD
`49097c6`: the primary `issues.labeled` dispatch path bypasses the governance
proxy (it routes straight to the OSY dispatch API or the local queue, and the
local queue calls OpenCode directly). The governance client only writes
`trace_id` into the JSON body — it never sends an `x-trace-id` HTTP header.

Happy path: GitHub issue → STAS picks it up → dispatch through the LLM
Governance proxy (kill-switch, rate-limit, guardrail) → OpenSymphony → result
posts back. Every hop shares one trace id.

## Current state (audited at HEAD 49097c6)

- `src/governance/client.ts` — `dispatchThroughGovernance()` exists, POSTs to
  `${PROXY_DISPATCH_URL}/api/stas/webhook`, embeds `trace_id` in body, handles
  `402` (kill) and `429` (rate-limit) explicitly. Reads `config.proxy.dispatchUrl`.
- `src/webhooks/github.ts` — **only the `issues.edited` handler** routes through
  governance. The primary `issues.labeled` handler (line ~464) goes
  `config.osy.dispatchUrl` → `dispatchIssueToOsy()` or local queue. No
  `x-trace-id` header anywhere in the governance path. Governance client log
  lines omit `trace_id`.
- `src/utils/trace.ts` — `generateTraceId()` (UUID v4), `TRACE_HEADER =
  'x-stas-trace-id'` used by the OSY dispatch path.
- Governance proxy `POST /api/stas/webhook` (llm-governance repo): reads
  `trace_id` from the JSON body, responds/forwards with `X-Trace-ID`,
  kill-switch 402/503, rate-limit 429.

## Plan

1. **Config** (`src/config.ts`): add `GOVERNANCE_ENABLED` (bool, default false),
   `GOVERNANCE_URL` (default `http://llm-governance:4002`, matching
   docker-compose), `GOVERNANCE_TIMEOUT_MS`. Default off keeps current behavior
   and existing tests green.
2. **Governance client** (`src/governance/client.ts`): resolve base URL from
   `GOVERNANCE_URL` when enabled (fall back to `PROXY_DISPATCH_URL` for
   backward compat); send `x-trace-id` HTTP header; explicit `503` kill-switch
   handling; `trace_id` on every dispatch log line; fetch timeout (fail-closed).
3. **Dispatch path** (`src/webhooks/github.ts`): route the primary
   `issues.labeled` path through `dispatchThroughGovernance()` when
   `GOVERNANCE_ENABLED` (or `PROXY_DISPATCH_URL`) is set; on failure fail-closed
   (post governance-failure comment, no agent run). Keep OSY/local-queue fallback
   exactly as-is when governance is disabled.
4. **Tests** (`src/__tests__/governance/client.test.ts`): mocked http server —
   POST + `x-trace-id` header asserted; `trace_id` in log lines; 402/503 abort
   (no run); disabled → no request made.
5. **Manual verification**: tiny node mock governance server; run
   `dispatchThroughGovernance()` with `GOVERNANCE_ENABLED=true`; capture the
   received `x-trace-id` header + matching STAS log line; repeat with mock
   returning 402 to show no agent run.

## Acceptance

- `npm test` green (incl. `src/__tests__/github/messages.test.ts`).
- `npm run build` (tsc) exits 0.
- Evidence: mock governance server logs showing `x-trace-id` + STAS log line
  with the same `trace_id`; 402 path aborts dispatch.
