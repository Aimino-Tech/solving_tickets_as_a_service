# Cost Explosion Prevention: Strategy & Safeguards

> **Preventing infinite loops from burning API funds unnoticed.**
> **Ticket**: AIM-3353
> **Status**: Draft for review
> **Last updated**: 2026-07-20

---

## Executive Summary

STAS agents execute LLM calls, sandbox commands, and GitHub API interactions on
every fix run. Each operation costs real money — inference at $3–6/fix, sandbox
compute at $0.20–0.50/fix, and GitHub API calls at negligible per-unit cost but
potentially explosive volume in a loop.

> **The Core Risk**: An agent stuck in an infinite loop — repeatedly calling the
> same LLM endpoint, generating the same broken diff, re-running the same
> failing tests — can burn **$50–500+ in API costs within minutes** before any
> human notices. In a multi-tenant SaaS deployment, a single runaway ticket on a
> busy weekend could consume the day's margin for an entire customer cohort.

This document defines a multi-layered strategy to prevent, detect, and limit
cost explosions. The approach combines **hard technical caps**, **algorithmic
loop detection**, **real-time alerting**, **pricing model safeguards**, and
**customer-facing transparency** — so that STAS never surprises a customer (or
Aimino) with an unmanageable bill.

**Key Commitments**:

1. Every fix run has a hard cost ceiling — no ticket can exceed it.
2. Loop and dead-end patterns are detected algorithmically mid-execution.
3. Customers see real-time cost burn on every ticket.
4. Aimino absorbs the cost of confirmed loops (we fixed the bug; we pay).
5. Fixed-price-per-ticket pricing eliminates customer cost anxiety entirely.

---

## 1. The Cost Explosion Risk

### 1.1 Real Scenarios

| Scenario | Trigger | Cost Impact | Detection Lag |
|----------|---------|-------------|---------------|
| **LLM retry loop** | Agent generates same broken fix repeatedly | $15–45/min | 2–5 min (until turn limit) |
| **Test-debug loop** | Tests always fail; agent re-runs them with identical fix | $10–30/min | 5–10 min (until timeout) |
| **Sandbox spawn loop** | Worker crashes and restarts repeatedly | $0.50–2/min | 1–3 min (supervisor FATAL) |
| **GitHub comment flood** | Agent posts status comments in a loop | $0 (API) but rate-limit trigger | < 1 min (GitHub blocks) |
| **Multi-tenant cascade** | One runaway agent exhausts shared worker pool | Indirect (blocked other jobs) | 5–15 min (queue backpressure) |
| **Model cascade regression** | Cheap model generates nonsense → expensive model tries to fix → repeat | $20–100/cycle | 10–30 min (manual review) |

### 1.2 Financial Impact Analysis

| Metric | Optimistic | Expected | Worst Case |
|--------|-----------|----------|------------|
| **Per-ticket loop cost** | $5 | $25 | $500+ |
| **Loop frequency** | 0.1% of tickets | 0.5% of tickets | 2% of tickets |
| **Monthly loops (1K fix/mo)** | 1 event | 5 events | 20 events |
| **Monthly loop cost (expected)** | $5 | $125 | $10,000+ |
| **Annualized exposure** | $60 | $1,500 | $120,000+ |
| **Customer trust impact** | Negligible | Moderate (support tickets) | Severe (churn, social media) |

> **Worst-case exposure** of $10K+/month is unacceptable. Even the expected case
> of $125/month erodes margin. The strategy below targets **zero undetected
> loops in production** — any loop that occurs must be caught and killed within
> 60 seconds.

### 1.3 Root Cause Analysis

Infinite loops in agent systems arise from three root causes:

1. **Prompt-Response Resonance** — The LLM produces the same output given the
   same context, causing the agent to repeat the same action. Most common with
   deterministic temperature=0 settings and identical tool outputs.

2. **Error Recovery Oscillation** — A transient error (network blip, sandbox
   timeout) triggers a retry that hits the same error, creating an infinite
   retry chain. Compounded when the retry logic does not back off.

3. **State Confusion** — The agent's internal state (e.g., "which files have I
   already modified?") diverges from reality. The agent thinks it is making
   progress but is re-doing completed work.

---

## 2. Hard Technical Limits

> **Principle**: Every ticket has a concrete, enforceable budget. Once the
> budget is consumed, execution stops — cleanly, immediately, and with a clear
> signal to both the operator and the customer.

### 2.1 Default Limits by Tier

| Limit | Free | Solo ($49/mo) | Team ($149/mo) | Enterprise | Self-Hosted |
|-------|------|---------------|----------------|------------|-------------|
| **Max steps per ticket** | 25 | 50 | 100 | Custom | Configurable |
| **Max API calls (LLM)** | 10 | 25 | 50 | Custom | Configurable |
| **Max runtime per ticket** | 5 min | 15 min | 30 min | Custom | Configurable |
| **Max token spend** | 50K tokens | 200K tokens | 500K tokens | Custom | Configurable |
| **Max dollar cost per ticket** | $1.00 | $5.00 | $10.00 | Custom | Configurable |
| **Max sandbox time** | 2 min | 10 min | 20 min | Custom | Configurable |
| **Concurrent tickets** | 1 | 3 | 10 | Custom | Unlimited |
| **Max retries per step** | 2 | 3 | 5 | Custom | Configurable |

### 2.2 Configuration Reference

All limits are configurable via environment variables, with sensible defaults
that prevent cost explosions even for unconfigured self-hosted deployments:

| Variable | Default | Applies To | Description |
|----------|---------|------------|-------------|
| `STAS_MAX_STEPS_PER_TICKET` | `50` | All tiers | Max pipeline steps (phases × steps per phase) |
| `STAS_MAX_LLM_CALLS` | `25` | All tiers | Max LLM inference calls per ticket |
| `STAS_MAX_RUNTIME_SECONDS` | `900` (15 min) | All tiers | Wall-clock timeout per ticket |
| `STAS_MAX_TOKENS_PER_TICKET` | `200000` | All tiers | Max total tokens (input + output) |
| `STAS_MAX_COST_PER_TICKET` | `5.00` | All tiers | Max dollar cost per ticket |
| `STAS_MAX_SANDBOX_SECONDS` | `600` (10 min) | All tiers | Max cumulative sandbox execution time |
| `STAS_MAX_TURNS` | `25` | All tiers | Max LLM tool-call turns per session |
| `STAS_TURN_TIMEOUT_SECONDS` | `120` | All tiers | Max wall-clock seconds per single turn |
| `STAS_MAX_RETRIES_PER_STEP` | `3` | All tiers | Max retries for a single pipeline step |

### 2.3 Algorithmic Loop Detection

Beyond hard limits, the system detects **behavioral loops** that would not be
caught by a simple counter:

| Detection Method | Description | Implementation |
|-----------------|-------------|----------------|
| **Output equality** | If two consecutive phases produce identical output, mark as STUCK | `PipelineExecutor.checkLoop()` — compares `lastPhaseOutput` with current |
| **Error signature repetition** | If the same normalized error signature appears across runs for the same issue, mark DEAD_END | `PipelineExecutor.recordAndCheckDeadEnd()` — normalizes errors (strips numbers, paths) and tracks `Set<string>` per issue |
| **Cumulative budget exhaustion** | If cumulative token spend exceeds `costBudget.maxTokens`, mark BUDGET_EXHAUSTED | `PipelineExecutor.checkBudget()` — checked before each phase entry |
| **Turn limit** | If LLM tool-call turns exceed `maxTurns`, auto-kill session | `LimitManager.checkTurnLimit()` — Redis-backed counter with TTL |
| **Cost cap** | If cumulative USD cost exceeds `maxCost`, trigger cost-kill lock | `LimitManager.isCostCapped()` + `triggerCostKill()` — Redis SET NX for exactly-once enforcement |
| **Wall-clock timeout** | If total run duration exceeds timeout, kill task | `RunawayGuard` — Celery signal handler + Redis lock |
| **Stalled job detection** | If worker does not send heartbeat within interval, re-queue | BullMQ `stalledInterval` — job-level timeout |
| **Supervisor restart loop** | If worker crashes > N times within window, enter FATAL | Supervisor `maxRestarts` + `restartWindowSeconds` |

### 2.4 Kill-Switch & Automatic Suspension

When any limit is breached, the system takes progressively severe actions:

```
Phase 1 — Warning (at 80% of limit)
  └─ Log WARNING, emit OpenTelemetry span, label issue `stas:budget-warning`

Phase 2 — Soft Kill (at 100% of limit)
  └─ Log ERROR, mark step as `budget_exhausted` / `stuck` / `dead_end`
  └─ Label issue `stas:timeout` or `stas:budget-exhausted`
  └─ Post status comment on GitHub issue: "STAS stopped — {reason}"

Phase 3 — Hard Kill (if retry loop detected)
  └─ Acquire Redis kill lock (SET NX with 24h TTL) — exactly-once enforcement
  └─ Celery `Ignore()` exception — silently kills task, no retry
  └─ Supervisor transitions to FATAL if worker keeps crashing

Phase 4 — Tenant Suspension (triggered by ops)
  └─ Admin API: `POST /admin/tenants/{id}/suspend`
  └─ Stops all queued and running jobs for that tenant
  └─ Notifies tenant admin via email + Slack
  └─ Requires manual reactivation by Aimino ops
```

### 2.5 Redis-Backed Lock Schema

```
stas:lock:timeout:<task_id>       ← SET NX — only one worker emits timeout
stas:lock:costcap:<task_id>       ← SET NX — only one worker triggers cost kill
stas:lock:turn:<session_id>       ← SET NX — turn counter lock
stas:counter:turn:<session_id>    ← INCR — turn number (expires after TTL)
stas:lock:suspend:<tenant_id>     ← SET — tenant suspension lock

stas:runaway:<task_id>            ← start epoch (guard.mark_start)
stas:runaway:tokens:<task_id>     ← cumulative tokens consumed
stas:runaway:cost:<task_id>       ← cumulative cost (millicents)
stas:runaway:retries:<session>    ← retry counter
stas:runaway:labeled:<repo>/<n>   ← dedup for stas:timeout label

stas:budget:cumulative:<session_id>  ← cumulative budget tracker
stas:deadend:<owner>/<repo>/<n>      ← error signature set (stored as Redis Set)
```

All keys carry TTL (2h for task tracking, 24h for dedup/retries, 1h for turn
locks, 24h for suspension locks). Expired keys are auto-evicted.

---

## 3. Alerting & Monitoring

### 3.1 Customer-Facing Dashboards

Customers need real-time visibility into cost burn to trust the system:

```
┌──────────────────────────────────────────────────────────────────┐
│  TICKET #42 — Cost Dashboard                         [LIVE]      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Current Session Cost:  $2.40                                    │
│  Budget:                $5.00  ████████░░░░░░░░░░  48% used      │
│  Tokens Used:           48,230 / 200,000                          │
│  Elapsed:               3m 42s / 15m                              │
│  LLM Calls:             7 / 25                                    │
│  Steps Completed:       4 / 10                                    │
│                                                                   │
│  Cost Breakdown:                                                  │
│    Inference:     $2.10  ████████████████████████  87.5%          │
│    Sandbox:       $0.25  ███                      10.4%          │
│    API Overhead:  $0.05  ▋                        2.1%           │
│                                                                   │
│  ⚠ Budget Warning at 80% — currently at 48%                       │
│                                                                   │
│  [Pause Agent] [Cancel Ticket] [Increase Budget]                  │
└──────────────────────────────────────────────────────────────────┘
```

Dashboard features by tier:

| Feature | Free | Solo | Team | Enterprise |
|---------|------|------|------|------------|
| Live cost burn per ticket | ✅ | ✅ | ✅ | ✅ |
| Budget vs actual gauge | ✅ | ✅ | ✅ | ✅ |
| Token & call counters | ✅ | ✅ | ✅ | ✅ |
| Cost breakdown by component | ❌ | ✅ | ✅ | ✅ |
| Historical cost per fix | ❌ | ✅ (7d) | ✅ (30d) | ✅ (90d) |
| Monthly spend projection | ❌ | ❌ | ✅ | ✅ |
| Team-wide cost aggregation | ❌ | ❌ | ✅ | ✅ |
| Usage alerts configuration | ❌ | ❌ | ✅ | ✅ |
| API export of cost data | ❌ | ❌ | ❌ | ✅ |

### 3.2 Internal Alerting Thresholds

| Condition | Severity | Channel | Action |
|-----------|----------|---------|--------|
| >3 `stas:timeout` labels per hour | Warning | Slack `#stas-alerts` | Investigate issue queue |
| Any cost-cap kill event | Critical | Slack `#stas-critical` + PagerDuty | Review agent budget |
| Supervisor FATAL state | Critical | Slack `#stas-critical` + PagerDuty | Restart worker pool |
| BullMQ DLQ depth > 10 | Warning | Slack `#stas-alerts` | Drain and inspect DLQ |
| Per-tenant cost spike > 5× baseline | Warning | Slack `#stas-alerts` | Notify customer success |
| Monthly loop cost > $500 | Critical | Slack `#stas-critical` | Incident review |
| Same issue retried > 5 times | Info | Slack `#stas-alerts` | Check if loop detection missed it |
| Single ticket cost > $25 | Warning | Slack `#stas-alerts` | Manual review |
| Global cost burn rate > $50/hr | Critical | Slack `#stas-critical` + PagerDuty | Potential systemic issue |

### 3.3 Automatic Suspension Triggers

Suspension is automatic (no human in the loop) for these conditions:

| Trigger | Action | Recovery |
|---------|--------|----------|
| 3 consecutive cost-cap kills for same tenant in 1 hour | Suspend tenant for 15 min | Auto-unsuspend after cooldown |
| 5 cost-cap kills in 24 hours for same tenant | Suspend tenant until manual review | Operator investigates and reactivates |
| Worker FATAL state | Stop dispatching to that worker pool | Auto-restart via KEDA + supervisor |
| Budget exhaustion across >50% of active tickets | Throttle new ticket acceptance | Auto-recover when burn rate normalizes |
| Suspected prompt injection causing spending loop | Immediate full-platform pause | Incident response team investigates |

### 3.4 OpenTelemetry Tracing

Every runaway event emits an OpenTelemetry span:

```python
# Span: stas.runaway.execution
span.set_attribute("task.name", task_name)
span.set_attribute("task.id", task_id)
span.set_attribute("runaway.reason", reason)  # "timeout" | "cost_cap" | "max_turns" | "dead_end" | "stuck"
span.set_attribute("runaway.turn_count", turn_count)
span.set_attribute("runaway.cost_millicents", cost_millicents)
span.set_attribute("runaway.duration_ms", duration_ms)
span.set_attribute("tenant.id", tenant_id)
span.set_status(Status.ERROR, description=reason)
```

---

## 4. Cost Liability Model

> **Principle**: Infinite loops are our bug, not the customer's bill.

### 4.1 Liability Matrix

| Scenario | Who Pays | Reasoning |
|----------|----------|-----------|
| Agent hits hard limit (timeout/turn cap) | Aimino absorbs | System worked as designed — limit prevented explosion |
| Cost-cap kill triggered | Aimino absorbs | Cap prevented cost from exceeding budget |
| Loop detected and killed algorithmically | Aimino absorbs | Detection system worked — false starts are our cost |
| Loop NOT detected — customer billed > limits | **Aimino refunds + 2× credit** | System failed — we make the customer whole |
| Customer misconfigures (e.g., sets unlimited budget) | Customer pays up to cap* | We warned; we cap at configurable maximum |
| Self-hosted with own API key | Customer pays API provider | We give them the tools; they set their own limits |
| Fixed-price-per-ticket model | Aimino always pays | Customer pre-paid; loops are our margin problem |

> \* Even for customer misconfiguration, we enforce a **platform-wide absolute
> cap** (default: $25/ticket) that cannot be overridden without contacting
> Aimino support. This is a safety net — not a billing mechanism.

### 4.2 Refund Policy

If a loop costs a customer money:

1. **Automatic refund** — Any ticket where the cost-cap kill fires is
   automatically credited. No ticket required.
2. **2× compensation** — If the loop was NOT detected by our systems and the
   customer had to contact us, we credit 2× the overage.
3. **Manual review threshold** — Any single ticket exceeding $25 triggers a
   manual review and automatic credit of the excess.

### 4.3 Fixed-Price-Per-Ticket Model

The simplest way to eliminate customer cost anxiety: **Aimino charges a flat
fee per successful fix, regardless of how many attempts or tokens it consumed
internally.**

| Model | Customer Risk | Aimino Risk | Notes |
|-------|--------------|-------------|-------|
| **Usage-based** (current) | Medium — loops cost them | Low — they pay for overage | Current model: $49/mo for 100 fixes |
| **Fixed per fix** | Zero — pre-paid per fix | High — loops eat margin | Recommended for Enterprise |
| **Hybrid** | Low — usage-based with hard cap | Medium — capped losses | Recommended for Solo/Team |

**Implementation** (Phase 2):

```
Pricing:
  - Base: $49/mo (Solo) — 100 fixes included
  - Overages: $0.75/fix (vs $3.50 cost — Aimino subsidizes)
  - Enterprise: Custom fixed price per fix, volume-discounted

Cap:
  - No single ticket can cost more than $5.00 on our side
  - If a ticket costs us >$5.00, we eat the difference
  - If loop costs us $50, customer still pays $0.75 (or nothing if included)

Result:
  - Customer has ZERO financial risk from loops
  - Aimino has strong incentive to fix loop bugs
  - Fixed per-fix price is a competitive differentiator
```

---

## 5. Pricing Model Transparency

### 5.1 How to Communicate Cost Risks to Customers

**Landing page / Signup flow:**

> **"You'll never pay for a loop."**
>
> STAS caps every fix at a maximum cost. If our agent goes in circles, we
> absorb the cost — not you. Your monthly bill is predictable:
> - **Solo**: $49/mo for up to 100 fixes
> - **Team**: $149/mo for up to 500 fixes
> - **Enterprise**: Custom flat rate per fix
>
> Every fix has a live cost dashboard so you always know what's happening.

**Dashboard banner:**

> Your fix is running within budget (48% used). If it hits the limit, we stop
> automatically and you won't be charged extra.

**Post-mortem notification (if a loop was stopped):**

> **Fix stopped — cost cap reached.**
> STAS automatically stopped work on this ticket because it exceeded the
> maximum allowed cost ($5.00). This sometimes happens with complex or
> ambiguous issues. **You were not charged for this attempt.** You can:
> - Re-run with a more detailed issue description
> - Contact support for a manual review
> - Increase your per-ticket budget (Team/Enterprise only)

### 5.2 Usage Caps & Notifications

| Cap | Notification | Channel | Lead Time |
|-----|-------------|---------|-----------|
| 50% of monthly fix allocation | "You've used 50% of your monthly fixes" | Email + In-app | N/A |
| 80% of monthly fix allocation | "You're at 80% — upgrade to avoid overage" | Email + In-app + Slack | N/A |
| 100% of monthly fix allocation | "You've exhausted your fixes" | Email + Slack | Immediately |
| Per-ticket budget approaching limit | "This fix is approaching its cost cap" | Dashboard live | At 80% |
| Cost-cap kill fires | "Fix stopped — cost cap reached" | Dashboard + GitHub comment | Immediately |

### 5.3 Transparent Billing Breakdown

Every invoice includes a detailed breakdown:

```
STAS Invoice — July 2026
────────────────────────────────────────────
Plan: Team ($149/mo)
Status: Paid

Fix Usage:
  Included:       500 fixes
  Used:           342 fixes
  Remaining:      158 fixes
  Overage:        0 ($0.00)

Processing Summary:
  Total tickets processed:     342
  Successful fixes:            297 (86.8%)
  Failed (system):             28  (8.2%)
  Stopped (cost cap):          12  (3.5%)
  Skipped (no fix possible):   5   (1.5%)

Cost Cap Events:
  Total cost capped:   12 tickets
  Total absorbed:      $36.40
  Customer charged:    $0.00
  Avg cost per cap:    $3.03

Total Charged: $149.00
────────────────────────────────────────────
```

---

## 6. Competitive Analysis — Cost Risk Handling

### 6.1 Competitor Comparison

| Company | Cost Model | Loop Protection | Transparency | Customer Liability |
|---------|-----------|----------------|--------------|-------------------|
| **STAS** (current) | Usage-based + hard cap | Multi-layer (turn, cost, timeout, loop detect) | Live dashboard per ticket | Aimino absorbs loop costs |
| **STAS** (target) | Fixed per fix + cap | Same + dead-end + algorithmic | Same + monthly breakdown | Aimino always pays for loops |
| **Devin** | ACU credits ($20–500/mo) | Unknown internal limits | ACU burn dashboard | Failed tasks consume credits unreimbursed |
| **OpenHands** | Your API key | Configurable via env | None built-in | You pay API costs directly |
| **GitHub Copilot** | $10–39/mo fixed | N/A (autocomplete) | None | No loop risk (not agentic) |
| **Claude Code** | $35–50/mo fixed | Basic timeout | None | Could loop on API key |
| **Cursor** | $20/mo (500 requests) | Basic timeout | Usage counter | Requests consumed even on failures |
| **Sweep AI** | Free OSS / Cloud | Unknown | None | Unknown |

### 6.2 Key Competitive Insight

**No competitor offers fixed-price-per-fix pricing with loop absorption.**

- Devin charges per ACU (credit) — failed tasks consume credits unreimbursed.
  This creates exactly the cost anxiety STAS can eliminate.
- OpenHands is self-hosted — you pay your own API costs and manage your own
  limits. No cost protection whatsoever.
- GitHub Copilot is not an agent — it doesn't have loop risk, but it also
  doesn't resolve tickets autonomously.

**STAS's fixed-price model with loop absorption is a genuine market
differentiator**, particularly for:
- Risk-averse enterprise buyers who cannot accept variable API costs
- SMBs with limited budget who need predictable monthly spend
- German/DACH companies where cost predictability is a compliance requirement

### 6.3 Competitive Gap STAS Can Exploit

```
Current competitor positions on cost risk:
┌────────────────────────────────────────────────────────────────┐
│  HIGH PREDICTABILITY                                   LOW    │
├────────────────────────────────────────────────────────────────┤
│  STAS (target) ─── fixed per fix, loops absorbed              │
│  GitHub Copilot ── fixed monthly, no agent risk               │
│  Claude Code ───── fixed monthly, limited agent risk          │
│  Cursor ────────── fixed requests, consumed on failure        │
│  STAS (current) ── usage-based, hard cap, loops absorbed      │
│  Devin ─────────── usage-based (ACU), failed = consumed       │
│  OpenHands ─────── your API key, no protection                │
└────────────────────────────────────────────────────────────────┘

STAS's market position:
  "The only AI ticket solver where you never pay for a loop."
```

---

## 7. Technical Safeguards Architecture

### 7.1 Architecture Diagram

```
                                ┌──────────────────────────────────────┐
                                │         GitHub Issue                 │
                                │     (labeled stas:fix)               │
                                └─────────────┬────────────────────────┘
                                              │
                              ┌───────────────▼────────────────────────┐
                              │         Webhook / Queue                │
                              │         (BullMQ)                       │
                              │  • maxAttempts = 5                     │
                              │  • job timeout = 600s                  │
                              │  • stalled interval = 45s              │
                              │  → DLQ after maxAttempts               │
                              └───────────────┬────────────────────────┘
                                              │
                              ┌───────────────▼────────────────────────┐
                              │      Celery Worker (supervised)        │
                              │  • maxRestarts = 3                     │
                              │  • restartWindow = 60s                 │
                              │  → FATAL if exceeded                   │
                              └───────────────┬────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
          ┌─────────▼───────────┐  ┌──────────▼──────────┐  ┌─────────▼───────────┐
          │   RunawayGuard      │  │    LimitManager      │  │  PipelineExecutor    │
          │   (middleware.py)   │  │    (limits.py)       │  │  (pipelineExecutor)  │
          │                     │  │                      │  │                      │
          │  ┌───────────────┐  │  │  ┌────────────────┐  │  │  ┌────────────────┐  │
          │  │ Timeout check │  │  │  │ Turn limit     │  │  │  │ Loop detection │  │
          │  │ Tokens check  │  │  │  │ Cost cap lock  │  │  │  │ Dead-end detect│  │
          │  │ Cost check    │  │  │  │ Timeout lock   │  │  │  │ Budget check   │  │
          │  │ Retry check   │  │  │  │ Auto-kill      │  │  │  │ Tool allowlist │  │
          │  └───────────────┘  │  │  └────────────────┘  │  │  └────────────────┘  │
          └─────────┬───────────┘  └──────────┬───────────┘  └─────────┬───────────┘
                    │                         │                         │
                    └─────────────────────────┼─────────────────────────┘
                                              │
                              ┌───────────────▼────────────────────────┐
                              │        Redis (state + locks)           │
                              │  ┌──────────────────────────────────┐  │
                              │  │ stas:lock:timeout:<task>         │  │
                              │  │ stas:lock:costcap:<task>         │  │
                              │  │ stas:counter:turn:<session>      │  │
                              │  │ stas:budget:cumulative:<session> │  │
                              │  │ stas:deadend:<owner>/<repo>/<n>  │  │
                              │  │ stas:runaway:*                   │  │
                              │  └──────────────────────────────────┘  │
                              └───────────────┬────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
          ┌─────────▼───────────┐  ┌──────────▼──────────┐  ┌─────────▼───────────┐
          │   OpenTelemetry     │  │    Alert Manager     │  │  Tenant Suspension   │
          │   (tracing)         │  │    (Grafana/Pager)   │  │  (admin API)         │
          │                     │  │                      │  │                      │
          │  Span:              │  │  • Warning channels  │  │  POST /admin/        │
          │  stas.runaway.*     │  │  • Critical channels │  │    tenants/{id}/     │
          │                     │  │  • PagerDuty         │  │    suspend            │
          └─────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### 7.2 Data Flow — Loop Detection Sequence

```
1. Issue received → PipelineExecutor.start()
2. Phase resolves step → agent executes LLM call
3. Step completes → PipelineExecutor.advance()

   ┌────────────────────────────────────────────────────┐
   │ advance() checks in order:                         │
   │                                                     │
   │ ① Budget check: cumulativeTokens >= maxTokens?     │
   │    YES → mark BUDGET_EXHAUSTED, stop               │
   │                                                     │
   │ ② Loop check: output == lastPhaseOutput?           │
   │    YES → mark STUCK, stop                          │
   │                                                     │
   │ ③ Dead-end check: error signature seen before?     │
   │    YES → mark DEAD_END, stop                        │
   │                                                     │
   │ ④ All clear → advance to next phase/step           │
   └────────────────────────────────────────────────────┘

4. LimitManager (concurrent):
   - Turn counter increment → maxTurns? → auto_kill
   - Cost cap check → exceeded? → trigger_cost_kill (SET NX)

5. RunawayGuard (Celery signal):
   - task_prerun: check timeout, tokens, cost, retries
   - exceeded? → Ignore() + OpenTelemetry span + GitHub label

6. Any kill → tenant suspension check:
   - 3 kills in 1h? → auto-suspend 15 min
   - 5 kills in 24h? → suspend until manual review
```

### 7.3 Graceful Degradation

If Redis is unavailable:

| Component | Behavior Without Redis |
|-----------|----------------------|
| LimitManager | Falls back to in-memory dict (single-worker only — no cross-worker coordination) |
| RunawayGuard | Still fires via wall-clock timeout (local timer) — less precise but still works |
| PipelineExecutor | Still checks budget/loop/dead-end via in-memory state — no Redis dependency |
| Tenant suspension | Suspension state stored in-memory — lost on restart (acceptable for crash scenario) |
| Cost tracking | Falls back to approximate cost estimation from token counts |

> **Key property**: Loss of Redis never allows an unbounded cost explosion.
> Each layer degrades to a less precise but still-safe mode.

---

## 8. Implementation Roadmap

### 8.1 Phase 1: Foundation (Weeks 1–3) — P0

> **Goal**: Every ticket has hard limits. No single ticket can cost >$25.

| Task | Effort | Depends On | Owner | Done When |
|------|--------|-----------|-------|-----------|
| Enforce `STAS_MAX_STEPS_PER_TICKET` in PipelineExecutor | 1d | — | Backend | Test: step counter kills after N |
| Enforce `STAS_MAX_TOKENS_PER_TICKET` with Redis accumulator | 2d | — | Backend | Test: token budget exhausted |
| Enforce `STAS_MAX_COST_PER_TICKET` with millicents tracking | 2d | Cost tracking infra | Backend | Test: cost-cap kill fires |
| Add `STAS_MAX_LLM_CALLS` counter per ticket | 1d | — | Backend | Test: LLM call gating |
| Add `STAS_MAX_SANDBOX_SECONDS` to sandbox executor | 1d | — | Backend | Test: sandbox killed after N seconds |
| Document all env vars in `.env.example` and README | 1d | All above | Docs | PR merged |

### 8.2 Phase 2: Loop Detection (Weeks 4–6) — P0

> **Goal**: Algorithmic detection catches loops before they hit hard limits.

| Task | Effort | Depends On | Owner | Done When |
|------|--------|-----------|-------|-----------|
| Output equality loop detection (STUCK) | Existing | — | Backend | Tests pass (already implemented) |
| Error signature dead-end detection (DEAD_END) | Existing | — | Backend | Tests pass (already implemented) |
| Cross-session dead-end memory (Redis Set) | 2d | Redis infra | Backend | Dead-end persists across worker restarts |
| Notify customer on STUCK/DEAD_END via GitHub comment | 1d | — | Backend | Comment posted with clear action |
| Add "no progress over N steps" detection | 3d | Output equality | Backend | Detects gradual divergence loops |
| Add "file modification oscillation" detection | 3d | — | Backend | Detects write-revert-write patterns |

### 8.3 Phase 3: Alerting & Dashboards (Weeks 7–9) — P1

> **Goal**: Customers and operators see cost burn in real time.

| Task | Effort | Depends On | Owner | Done When |
|------|--------|-----------|-------|-----------|
| Live cost dashboard per ticket (React component) | 5d | Cost tracking API | Frontend | Widget renders real-time gauge |
| Internal alerting thresholds (Slack + PagerDuty) | 3d | — | Backend | Alerts fire correctly |
| OpenTelemetry spans for all runaway events | 2d | — | Backend | Grafana dashboard shows events |
| GitHub status comment on suspend/warning | 1d | — | Backend | Comment format approved |
| Customer-facing usage cap notifications | 3d | Billing | Full-stack | Email + Slack at 50/80/100% |
| Historical cost dashboard (7d/30d/90d) | 5d | Cost DB | Full-stack | Dashboard shows trends |

### 8.4 Phase 4: Pricing Model & Policy (Weeks 10–12) — P1

> **Goal**: Fixed-price-per-fix model with loop absorption.

| Task | Effort | Depends On | Owner | Done When |
|------|--------|-----------|-------|-----------|
| Fixed-price-per-fix billing option | 5d | Stripe integration | Backend | Enterprise can buy per-fix |
| Automatic refund for cost-capped tickets | 2d | Billing system | Backend | Credits issued automatically |
| Cost liability policy document | 2d | — | Legal/Product | Published on pricing page |
| Transparent billing breakdown on invoices | 3d | Billing system | Full-stack | Invoice shows cost cap events |
| "Absorbed cost" metric in dashboard | 2d | Dashboard | Frontend | Shows Aimino-absorbed loop costs |

### 8.5 Phase 5: Hardening & Scale (Weeks 13–16) — P2

> **Goal**: Protect against edge cases and scale to 5,000+ tickets/day.

| Task | Effort | Depends On | Owner | Done When |
|------|--------|-----------|-------|-----------|
| Race condition testing for Redis locks | 3d | Phase 1 | QA | Chaos tests pass |
| Multi-tenant isolation: cost blast radius per tenant | 5d | — | Backend | Tenant A's loop doesn't affect Tenant B |
| Kill-switch for entire platform (one-click pause) | 3d | Admin API | Backend | Pause all ticket processing |
| Self-hosted defaults that prevent explosion | 2d | — | Backend | Out-of-box safe for any config |
| Loop detection benchmark suite | 5d | Phase 2 | QA | 100 loop scenarios tested |

---

## 9. Success Metrics & Targets

| Metric | Current | 1-Month Target | 3-Month Target | 6-Month Target |
|--------|---------|---------------|---------------|----------------|
| Undetected loop incidents | Unknown | 0 | 0 | 0 |
| Cost-cap kills per 1K tickets | Unknown | < 5 | < 2 | < 1 |
| Time to kill a loop | Unknown | < 60s | < 30s | < 15s |
| Customer-reported cost concerns | Unknown | < 1/mo | < 1/quarter | 0 |
| Loop detection precision | Unknown | > 80% | > 95% | > 99% |
| Loop detection recall | Unknown | > 90% | > 95% | > 99% |
| False positive rate (wrongly killed) | Unknown | < 5% | < 2% | < 1% |
| Avg cost per cost-cap kill | Unknown | < $5.00 | < $3.00 | < $2.00 |
| Customer cost dashboard usage | N/A | — | > 30% of active users | > 60% |
| Self-hosted deployments with limits configured | Unknown | > 50% | > 80% | > 95% |

---

## 10. Related Documents

- `docs/ops/runaway-protection.md` — Current runaway agent technical safeguards
- `docs/UNIT_ECONOMICS.md` — Per-fix cost structure and breakeven analysis
- `docs/pricing-model.md` — STAS pricing tiers and billing integration
- `docs/COST_OPTIMIZATION.md` — Cost reduction roadmap (inference, caching, model selection)
- `docs/failure-modes.md` — What STAS can and cannot fix
- `docs/ops/workspace-quota.md` — Disk quota and workspace isolation
- `workers/runaway/config.py` — Runaway protection configuration
- `workers/runaway/limits.py` — LimitManager with Redis TTL locks
- `workers/runaway/guard.py` — RunawayGuard state tracking
- `workers/runaway/middleware.py` — Celery signal handlers
- `src/pipeline/pipelineExecutor.ts` — Pipeline executor with confinement checks
- `src/metering/costs.ts` — Credit cost configuration per model
- `src/monitoring/costBreakdown.ts` — Per-tenant, per-fix cost tracking
- `src/__tests__/pipeline/agentConfinement.test.ts` — Confinement integration tests
