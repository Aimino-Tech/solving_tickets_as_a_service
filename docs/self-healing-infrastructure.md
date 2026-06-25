# Self-Healing Infrastructure

> AIM-2022: Auto-retry, dead worker recovery, queue drain monitoring

## Overview

The self-healing infrastructure provides resilience for STAS at 200-500 user scale.
It consists of several integrated subsystems that detect and recover from failures
without human intervention.

### Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Self-Healing System                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Heartbeat     │  │ DLQ Consumer │  │ Timeout      │  │
│  │ Monitor       │  │              │  │ Enforcer     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │          │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐  │
│  │ Dead Worker  │  │ Circuit      │  │ Queue Drain  │  │
│  │ Recovery     │  │ Breaker      │  │ Monitor      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Self-Healing Orchestrator           │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### Data Flow

```
Worker ──heartbeat──▶ Redis (stas:heartbeat:{id}, TTL=30s)
                         │
                         ▼
               HeartbeatMonitor ──▶ DeadWorkerRecovery
                 (checks every 15s)    │
                                       ├── Revoke tasks
                                       ├── Redistribute
                                       ├── Log incident
                                       ├── Fire metric
                                       └── K8s restart (opt)

Task ──failure──▶ RetryPolicy ──▶ CircuitBreaker
                     │                │
                     ├── backoff      ├── 5 failures → OPEN
                     ├── max_retries  ├── 60s → HALF_OPEN
                     └── retryable?   └── probe → CLOSED/OPEN

Task ──deadline──▶ TimeoutEnforcer
                     │
                     ├── 80% → Soft warning
                     └── 100% → Cancel + retry

Queue ──overflow──▶ QueueDrainMonitor
                      │
                      ├── Depth > 100 + no workers → alert
                      └── Auto-scale hint → KEDA
```

## Components

### 1. Worker Heartbeat Monitor

**File:** `src/monitoring/heartbeat.ts`

Tracks worker liveness via Redis keys with 30s TTL.

- `heartbeat(workerId)` — refreshes TTL on `stas:heartbeat:{workerId}`
- `getLiveWorkers()` — returns workers with recent heartbeats
- `isWorkerDead(workerId)` — true if heartbeat missing > 60s
- `startMonitor(intervalMs)` — periodic check for dead workers

**Events:**
- `heartbeat` — emitted when a heartbeat is recorded
- `deadWorker` — emitted when a worker is detected as dead
- `workerRevived` — emitted when a previously dead worker comes back

**Python Side:** `workers/self_healing/heartbeats.py`

Sends heartbeats from Celery workers via signals (`worker_ready`,
`worker_shutdown`, `heartbeat_sent`, `task_prerun`, `task_postrun`).

### 2. Exponential Backoff

**File:** `src/retry/backoff.ts`

Calculates retry delays: `delay = baseDelay * (multiplier ^ (attempt - 1))`

- Default: 1s, 4s, 16s for attempts 1, 2, 3
- Max 3 retries
- Configurable base delay, multiplier, max retries, max delay cap

### 3. Retry Policy

**File:** `src/retry/policy.ts`

Per-task-type retry configuration with circuit breaker integration.

- Configurable `maxRetries`, `baseDelayMs`, `multiplier` per task type
- `shouldRetryTask(taskType, error, attempt)` — checks all conditions
- Fatal error detection (validation, auth, not found errors are not retried)
- Circuit breaker integration (stops retries when system is overloaded)

**Supported task types:**
- `fix_issue` — 3 retries, 4x backoff
- `triage` — 2 retries, 4x backoff
- `sandbox` — 2 retries, 3x backoff
- `pr_creation` — 3 retries, 4x backoff
- `verification` — 2 retries, 4x backoff
- `notification` — 3 retries, 3x backoff
- `webhook` — 3 retries, 4x backoff

**Python Side:** `workers/self_healing/retry.py`

Configures Celery's built-in retry mechanism with per-task exponential backoff.

### 4. Dead Letter Queue Consumer

**File:** `src/queue/dlq.ts`

Consumes and replays messages from RabbitMQ DLX.

- Connects to `stas.dlx` exchange via direct binding
- Parses dead-lettered messages with x-first-death headers
- Deduplicates via Redis SET (`stas:dlq:dedup:{messageId}`)
- Replays to `stas.retry` exchange with incremented retry count

**Exchange topology:**
```
Queue ──DLX──▶ stas.dlx ──▶ stas.dlx.consumer (DLQConsumer)
                                │
                                ├── isDuplicate? → skip
                                └── replay ──▶ stas.retry
```

### 5. Timeout Enforcement

**File:** `src/queue/timeout.ts`

Tracks task deadlines and enforces soft/hard time limits.

- `startTracking(taskId, timeoutMs, taskType)` — sets Redis key with deadline
- `checkStuckTasks()` — finds tasks past deadline
- `cancelTask(taskId)` — cleanup and retry scheduling
- Soft limit (80%): warning only
- Hard limit (100%): cancel task, fire metric

**Per-task timeouts:**
- `fix_issue`: 10 min hard, 8 min soft
- `triage`: 30s hard, 24s soft
- `sandbox`: 5 min hard, 4 min soft
- `pr_creation`: 30s hard, 24s soft

**Python Side:** `workers/self_healing/timeouts.py`

Configures Celery's `task_soft_time_limit` and `task_time_limit` per task type.

### 6. Circuit Breaker

**File:** `src/circuit-breaker/index.ts`

Prevents cascading failures by stopping repeated calls to a failing operation.

**States:**
- **CLOSED** — normal operation, calls pass through
- **OPEN** — 5 consecutive failures, calls rejected for 60s
- **HALF_OPEN** — after 60s, one probe call allowed

**API:**
- `recordSuccess(key)` — reset failure count, close circuit
- `recordFailure(key)` — increment count, open at threshold
- `isAllowed(key)` — check if call can proceed
- `getState(key)` — get current state
- `reset(key)` — manually reset a circuit
- `getSnapshot()` — get all circuit states

### 7. Dead Worker Recovery

**File:** `src/monitoring/dead-worker.ts`

Handles dead worker detection and automatic recovery.

**Recovery process:**
1. **Detect** — listens to heartbeat monitor `deadWorker` events
2. **Revoke** — revoke all tasks assigned to the dead worker
3. **Redistribute** — re-enqueue tasks for live workers
4. **Record** — log incident with worker ID and timestamp
5. **Metric** — fire `stas_dead_workers_total` Prometheus counter
6. **Restart** — optionally restart via Kubernetes pod deletion

### 8. Queue Drain Monitor

**File:** `src/queue/drain.ts`

Monitors queue depth and detects stuck queues.

- `checkQueueDepth(queueName)` — checks RabbitMQ queue depth via Management API or AMQP
- `isQueueStuck(queueName, threshold)` — depth > 100 AND no workers
- `alertNoWorkers(queueName, depth)` — Slack alert when queue is stuck
- `autoScaleHint(depth)` — KEDA integration for auto-scaling

### 9. Integration

**File:** `src/monitoring/self-healing.ts`

Single entry point to start/stop all monitors.

```typescript
import { startSelfHealing, stopSelfHealing } from './monitoring/self-healing.js';

// Start all monitors during app boot
await startSelfHealing({
  heartbeatIntervalMs: 15_000,
  stuckTaskIntervalMs: 30_000,
  drainMonitorIntervalMs: 30_000,
});

// Graceful shutdown
await stopSelfHealing();
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SELF_HEALING_ENABLED` | `true` | Enable self-healing infrastructure |
| `HEARTBEAT_INTERVAL_MS` | `15000` | Heartbeat check interval |
| `HEARTBEAT_TTL_SECONDS` | `30` | Redis key TTL for heartbeats |
| `HEARTBEAT_DEAD_AFTER_MS` | `60000` | Time before worker considered dead |
| `STUCK_TASK_INTERVAL_MS` | `30000` | Stuck task check interval |
| `DRAIN_MONITOR_INTERVAL_MS` | `30000` | Queue drain check interval |
| `DLQ_CONSUMER_ENABLED` | `true` | Enable DLQ consumer |
| `STUCK_TASK_MONITOR_ENABLED` | `true` | Enable stuck task monitor |
| `QUEUE_DRAIN_MONITOR_ENABLED` | `true` | Enable queue drain monitor |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | Failures before circuit opens |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | `60000` | Time before circuit resets |
| `RETRY_BASE_DELAY_MS` | `1000` | Base delay for exponential backoff |
| `RETRY_MULTIPLIER` | `4` | Exponential backoff multiplier |
| `RETRY_MAX_ATTEMPTS` | `3` | Maximum retry attempts |
| `K8S_ENABLED` | `false` | Enable Kubernetes worker restart |
| `K8S_NAMESPACE` | `default` | Kubernetes namespace |
| `KEDA_ENABLED` | `false` | Enable KEDA auto-scaling hints |
| `KEDA_SCALED_OBJECT` | `stas-worker` | KEDA ScaledObject name |

## Prometheus Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `stas_dead_workers_total` | Counter | `workerId` | Total dead workers detected |
| `stas_dead_workers_current` | Gauge | `workerId` | Currently dead workers |
| `stas_dead_worker_recovery_failures_total` | Counter | `workerId` | Recovery failures |
| `stas_live_workers` | Gauge | — | Current live worker count |
| `stas_task_timeouts_total` | Counter | `taskType` | Hard timeout events |
| `stas_task_soft_timeouts_total` | Counter | `taskType` | Soft timeout warnings |
| `stas_tasks_cancelled_total` | Counter | `taskType` | Cancelled tasks |
| `stas_stuck_tasks` | Gauge | — | Currently stuck tasks |
| `stas_queue_depth` | Gauge | `queue` | Queue depth |
| `stas_queue_drain_alerts_total` | Counter | `queue` | Drain alerts fired |
| `stas_keda_scale_hint` | Gauge | `scaledObject` | KEDA scale hint |
| `dlq_replayed_total` | Counter | `queue` | DLQ messages replayed |
| `dlq_duplicates_total` | Counter | — | Duplicate DLQ messages |

## Testing

```bash
# Run backoff, retry policy, and circuit breaker tests
npx vitest run src/__tests__/retry/

# Run with coverage
npx vitest run src/__tests__/retry/ --coverage
```

## Usage Guide

### Starting the self-healing system

```typescript
// In your app startup (e.g., src/index.ts)
import { startSelfHealing } from './monitoring/self-healing.js';

async function main() {
  // ... other startup logic ...

  if (config.selfHealing.enabled) {
    await startSelfHealing({
      heartbeatIntervalMs: config.selfHealing.heartbeatIntervalMs,
      stuckTaskIntervalMs: config.selfHealing.stuckTaskIntervalMs,
      drainMonitorIntervalMs: config.selfHealing.drainMonitorIntervalMs,
    });
  }
}
```

### Recording a worker heartbeat

```typescript
import { workerHeartbeatMonitor } from './monitoring/heartbeat.js';

// Worker sends heartbeat on startup and periodically
await workerHeartbeatMonitor.heartbeat('worker-1');
```

### Using the retry policy

```typescript
import { retryPolicy } from './retry/policy.js';

async function executeWithRetry(taskType: string, fn: () => Promise<void>) {
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      await fn();
      return; // Success
    } catch (err) {
      if (!retryPolicy.shouldRetryTask(taskType, err as Error, attempt)) {
        throw err;
      }
      const delay = retryPolicy.getDelay(taskType, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Using the circuit breaker

```typescript
import { circuitBreaker } from './circuit-breaker/index.js';

async function callWithCircuitBreaker(key: string, fn: () => Promise<void>) {
  if (!circuitBreaker.isAllowed(key)) {
    throw new Error('Circuit breaker is open');
  }

  try {
    await fn();
    circuitBreaker.recordSuccess(key);
  } catch (err) {
    circuitBreaker.recordFailure(key);
    throw err;
  }
}
```

## Python Celery Integration

### Setting up heartbeats in Celery

```python
# In your Celery app setup
from workers.self_healing.heartbeats import setup_heartbeat_monitor

app = Celery("stas")
setup_heartbeat_monitor(app)
```

### Configuring retry in Celery

```python
from workers.self_healing.retry import configure_retry_policy
configure_retry_policy(app)
```

### Configuring timeouts in Celery

```python
from workers.self_healing.timeouts import configure_timeout_policy
configure_timeout_policy(app)
```

## Monitoring and Alerts

The self-healing system integrates with the existing alerting infrastructure:

- **Dead worker**: Critical alert via Slack + email
- **Queue stuck**: Critical alert when depth > 100 with no workers
- **Task timeout**: Warning alert on soft limit, metric on hard limit
- **Circuit breaker open**: Warning on each task type
- **DLQ messages**: Warning when messages are dead-lettered
