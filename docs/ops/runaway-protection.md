# Runaway Agent Protection

> Preventing unbounded agent execution — timeout, turn limit, cost cap, auto-kill.
> Last updated: 2026-06-25

## Overview

STAS agents invoke LLMs, run sandbox commands, and interact with GitHub. Each
of these operations costs money and consumes wall-clock time. The **runaway
protection** subsystem ensures no single issue-fix run can exceed configurable
bounds, protecting both the operator's budget and the platform's stability.

```
                  ┌─────────────────────────┐
                  │     GitHub Issue         │
                  │     (labeled stas:fix)    │
                  └─────┬───────────────────┘
                        │
                  ┌─────▼───────────────────┐
                  │   Webhook / Queue        │
                  │   (BullMQ)               │
                  │   • maxAttempts = 5      │
                  │   • job timeout = 600s   │
                  │   • stalled interval     │
                  └─────┬───────────────────┘
                        │
                  ┌─────▼───────────────────┐
                  │   Celery Worker           │
                  │   (supervisor-managed)    │
                  │   • max restarts = 3      │
                  │   • restart window = 60s  │
                  └─────┬───────────────────┘
                        │
                  ┌─────▼───────────────────┐
                  │   RunawayGuard            │
                  │   (middleware.py)         │
                  │   ┌─────────────────┐    │
                  │   │ ● Timeout check  │    │
                  │   │ ● Token check    │    │
                  │   │ ● Cost check     │    │
                  │   │ ● Retry check    │    │
                  │   └─────────────────┘    │
                  └─────┬───────────────────┘
                        │
                  ┌─────▼───────────────────┐
                  │   LimitManager            │
                  │   (limits.py)             │
                  │   ┌─────────────────┐    │
                  │   │ ● Turn limit     │    │
                  │   │ ● Cost cap lock  │    │
                  │   │ ● Timeout lock   │    │
                  │   │ ● Auto-kill      │    │
                  │   └─────────────────┘    │
                  └─────────────────────────┘
```

## Architecture

The protection is layered across four components:

| Layer | Component | Scope | Action |
|-------|-----------|-------|--------|
| 1 — Job Queue | BullMQ (`config.py`) | Job-level timeout, retries, stalled-job detection | Moves job to DLQ after `maxAttempts` |
| 2 — Process | Supervisor (`config.py`) | Worker-crash limits | Stops restart loop after `maxRestarts` |
| 3 — Runtime | RunawayGuard (`guard.py`) | Per-task wall-clock, tokens, cost, retries | Raises `Ignore` + labels issue `stas:timeout` |
| 4 — Turn/Cap | LimitManager (`limits.py`) | Per-session turn count, cost-cap lock, timeout lock | Records auto-kill metadata |

## Configuration Reference

### BullMQ (job queue)

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_BULLMQ_MAX_ATTEMPTS` | `5` | Max job retries before dead-letter |
| `STAS_BULLMQ_JOB_TIMEOUT_SECONDS` | `600` | Per-job wall-clock timeout |
| `STAS_BULLMQ_STALLED_INTERVAL_SECONDS` | `45` | Stalled-job detection interval |
| `STAS_BULLMQ_WORKER_CONCURRENCY` | `4` | Concurrent jobs per worker |
| `STAS_BULLMQ_DRAIN_DELAY_SECONDS` | `5` | Worker poll-loop drain timeout |

### Supervisor (process manager)

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_SUPERVISOR_MAX_RESTARTS` | `3` | Max consecutive failures before FATAL |
| `STAS_SUPERVISOR_RESTART_WINDOW_SECONDS` | `60` | Evaluation window for max restarts |
| `STAS_SUPERVISOR_RESTART_DELAY_SECONDS` | `5` | Delay between restart attempts |
| `STAS_SUPERVISOR_PRIORITY_AGENT` | `100` | Agent worker start priority |
| `STAS_SUPERVISOR_PRIORITY_HOUSEKEEPING` | `200` | Housekeeping worker priority |
| `STAS_SUPERVISOR_AUTOSTART` | `true` | Auto-start on supervisor boot |

### OpenTelemetry (observability)

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `""` | OTLP exporter endpoint (empty = drop) |
| `OTEL_SERVICE_NAME` | `"stas-runaway"` | Tracing dashboard service name |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Sampling rate (0.0–1.0) |
| `STAS_OTEL_SPAN_RUNAWAY` | `"stas.runaway.execution"` | Span name for runaway events |
| `OTEL_BSP_MAX_QUEUE_SIZE` | `2048` | Batch span processor queue |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | `512` | Max spans per export batch |
| `OTEL_BSP_SCHEDULE_DELAY` | `5000` | Batch schedule delay (ms) |

### Redis key TTLs

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_REDIS_TASK_TTL_SECONDS` | `7200` | Per-task tracking keys (start, tokens, cost) |
| `STAS_REDIS_LABEL_TTL_SECONDS` | `86400` | `stas:timeout` label dedup key |
| `STAS_REDIS_RETRY_TTL_SECONDS` | `86400` | Retry counter keys |
| `STAS_REDIS_TURN_LOCK_TTL_SECONDS` | `3600` | Turn-lock & turn-counter keys |
| `STAS_REDIS_COST_CAP_TTL_SECONDS` | `86400` | Cost-cap kill lock keys |

### Runaway guard limits

| Variable | Default | Description |
|----------|---------|-------------|
| `STAS_RUNAWAY_TIMEOUT_SECONDS` | `600` | Max wall-clock seconds per task |
| `STAS_RUNAWAY_MAX_TOKENS` | `100000` | Max tokens consumed per task |
| `STAS_RUNAWAY_MAX_COST` | `10.0` | Max USD cost per task |
| `STAS_RUNAWAY_MAX_RETRIES` | `3` | Max retries per session |
| `STAS_RUNAWAY_MAX_TURNS` | `25` | Max LLM-tool-call turns per session |
| `STAS_RUNAWAY_TURN_TIMEOUT_SECONDS` | `120` | Max seconds per single turn |
| `STAS_DEFAULT_TIER` | `"free"` | Default plan tier |
| `STAS_RUNAWAY_TIER_LIMITS` | `""` | Per-tier overrides |
| `RUNAWAY_LOCK_DIR` | `/tmp/stas-runaway` | File-based fallback directory |

## Redis Key Schema

```
stas:runaway:<task_id>            ← start epoch (guard.mark_start)
stas:runaway:tokens:<task_id>     ← cumulative tokens
stas:runaway:cost:<task_id>       ← cumulative cost
stas:runaway:retries:<session>    ← retry counter
stas:runaway:labeled:<repo>/<n>   ← dedup for stas:timeout label

stas:lock:timeout:<task_id>       ← timeout lock (SET NX)
stas:lock:costcap:<task_id>       ← cost-cap kill lock (SET NX)
stas:counter:turn:<session>       ← turn counter
```

All keys carry a TTL matching their purpose (2 h for task tracking, 24 h for
dedup/retries, 1 h for turn locks). Expired keys are automatically evicted.

## How It Works

### 1. Job-Queue Layer (BullMQ)

BullMQ enforces job-level timeouts and retry budgets:

- Every job has a configurable `timeout` — if the worker does not complete
  within this window, BullMQ marks it **stalled** and re-queues it.
- After `maxAttempts` stalled or failed attempts, the job moves to the
  **dead-letter queue** (DLQ) for manual inspection.
- Workers poll with a configured `concurrency` to avoid overwhelming the
  agent backend.

### 2. Process Layer (Supervisor)

Supervisor keeps Celery workers alive:

- If a worker process crashes, supervisor restarts it (up to `maxRestarts`
  times within `restartWindowSeconds`).
- If the crash rate exceeds the threshold, supervisor transitions the
  process group to **FATAL** and stops trying.
- Agent workers are given a higher priority (`100`) so they restart before
  housekeeping tasks.

### 3. Runtime Guard (RunawayGuard)

The guard intercepts every Celery task via signal handlers in
`middleware.py`:

1. **`task_prerun`** — records the start time, then runs all checks
   (timeout, tokens, cost, retry count).
2. **If any limit is exceeded** — raises `celery.exceptions.Ignore` to
   silently kill the task, emits an OpenTelemetry span, and labels the
   originating GitHub issue ``stas:timeout``.
3. **`task_postrun`** — cleans up tracking state for successful or ignored
   tasks (failed tasks keep state so the retry mechanism still works).

Guarded tasks include all agent dispatch, sandbox, verification, PR creation,
notification, and pipeline-orchestrator tasks.  Housekeeping and health-check
tasks are exempt.

### 4. Turn & Cap Layer (LimitManager)

The LimitManager adds Redis-backed TTL locks for safe concurrent enforcement:

- **Turn counting** — each LLM tool-call turn increments a Redis counter.
  When it exceeds `maxTurns`, the session is auto-killed.
- **Timeout lock** — `SET NX` with TTL ensures only one worker emits the
  timeout event when a task stalls.
- **Cost-cap lock** — prevents duplicate cost-kill actions when two workers
  detect the breach simultaneously.
- **Auto-kill record** — structured metadata (session, reason, turn count)
  is logged for downstream alerting.

## Alerting

When a runaway event is triggered:

1. The issue is labeled ``stas:timeout`` on GitHub.
2. An OpenTelemetry span is emitted with attributes:
   - `task.name`, `task.id`
   - `execution.duration_ms`
   - `runaway.reason`
3. The span status is set to `ERROR` with the reason as description.

Recommended alert rules:

| Condition | Severity | Action |
|-----------|----------|--------|
| More than 3 `stas:timeout` labels per hour | Warning | Investigate issue queue |
| Any cost-cap kill event | Critical | Review agent budget |
| Supervisor FATAL state | Critical | Restart worker pool |
| BullMQ DLQ depth > 10 | Warning | Drain and inspect DLQ |

## Troubleshooting

**Q: A job is stuck in active state but not progressing.**

Check BullMQ stalled-interval settings. Increase `STAS_BULLMQ_STALLED_INTERVAL_SECONDS`
if the agent's startup time exceeds the current window. Workers must send heartbeats
within this interval or they are considered stalled.

**Q: The stas:timeout label was applied incorrectly.**

Reset the dedup key in Redis:

```bash
redis-cli DEL "stas:runaway:labeled:owner/repo/42"
```

Then re-run the issue.

**Q: Supervisor is in FATAL state and will not restart workers.**

Check the worker logs for repeated crashes. Common causes:

- OOM kill (increase container memory)
- Python import error after deployment
- RabbitMQ / Redis connection refused

After fixing the cause, restart supervisor manually:

```bash
supervisorctl reread && supervisorctl update && supervisorctl start stas-worker:
```

**Q: Turn limit is too low for complex issues.**

Increase `STAS_RUNAWAY_MAX_TURNS` in the environment.  For enterprise-tier
repos the tier-system override can be used:

```bash
STAS_RUNAWAY_TIER_LIMITS="free=300,50000,5.0;pro=600,100000,10.0;enterprise=900,200000,20.0"
```

## Related

- `workers/runaway/config.py` — OSS tool configuration
- `workers/runaway/limits.py` — LimitManager with TTL locks
- `workers/runaway/guard.py` — RunawayGuard state tracking
- `workers/runaway/middleware.py` — Celery signal handlers
- `workers/tests/test_runaway.py` — Guard & middleware tests
- `workers/tests/test_runaway_config.py` — Config & limits tests
- `ops/playbook.md` — Alert response playbooks
