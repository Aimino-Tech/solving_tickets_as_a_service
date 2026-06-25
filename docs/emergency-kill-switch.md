# Emergency Kill Switch

## Overview

The emergency kill switch provides a **global stop-all-agents mechanism** for
STAS. When activated, all running agents are terminated, pending dispatches are
routed to a hold queue, and no new tasks are allowed to start.

This is a last-resort mechanism for incidents where agents are malfunctioning,
consuming excessive resources, or behaving unexpectedly.

## Architecture

```
                     ┌──────────────────┐
                     │   Admin API      │
                     │  POST /api/      │
                     │  emergency-stop  │
                     └────────┬─────────┘
                              │
                    ┌─────────▼──────────┐
                    │  EmergencyStop     │
                    │  (stop.ts)         │
                    │                    │
                    │  ┌─ Redis key      │
                    │  │ (stas:emergency │
                    │  │ _stop)          │
                    │  │                 │
                    │  ├─ Lock file      │
                    │  │ (/tmp/stas-     │
                    │  │ emergency-stop  │
                    │  │ .lock)          │
                    │  │                 │
                    │  └─ In-memory      │
                    │     cache          │
                    └────────┬──────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼─────┐      ┌──────▼───────┐     ┌──────▼───────┐
   │ TypeScript │      │  Celery      │     │  Express    │
   │ Middleware │      │  Middleware  │     │  Routes     │
   │ (dispatch  │      │ (task_prerun│     │  (Admin API)│
   │  wrapper)  │      │  signal)    │     │             │
   └────────────┘      └──────────────┘     └──────────────┘
```

## Components

### 1. TypeScript Module (`src/emergency/`)

| File | Purpose |
|---|---|
| `stop.ts` | Core `EmergencyStop` class — activate, deactivate, check, getStatus |
| `middleware.ts` | Express middleware + dispatch wrapper for task interception |
| `routes.ts` | REST API endpoints (activate, deactivate, status) |
| `notify.ts` | Linear issue notification on activation |
| `queue.ts` | RabbitMQ hold/resume queue management |
| `index.ts` | Barrel exports |

### 2. Python Worker Module (`workers/emergency/`)

| File | Purpose |
|---|---|
| `__init__.py` | Module exports |
| `stop.py` | `EmergencyStop` class (Python mirror — Redis + file check) |
| `middleware.py` | Celery `task_prerun` signal handler |
| `revoke.py` | Force-revoke all running agent tasks |

### 3. Monitoring (`src/monitoring/emergency-metrics.ts`)

Prometheus metrics exposed:

| Metric | Type | Description |
|---|---|---|
| `stas_emergency_stop_active` | Gauge | 1 if active, 0 if inactive |
| `stas_emergency_stop_activated_at` | Gauge | Unix timestamp of activation |
| `stas_tasks_held` | Gauge | Count of tasks in hold queue |
| `stas_tasks_routed_to_hold_total` | Counter | Total tasks routed to hold queue |
| `stas_emergency_stop_events_total` | Counter | Lifecycle events (activate/deactivate/hold/resume) |

## API Endpoints

All endpoints require admin authentication (`Authorization: Bearer <ADMIN_API_KEY>`).

### `POST /api/emergency-stop`

Activate the kill switch.

**Request body:**
```json
{
  "reason": "Critical vulnerability in sandbox environment"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Emergency stop activated — all agents halted",
  "reason": "Critical vulnerability in sandbox environment",
  "activatedAt": "2025-01-01T00:00:00.000Z"
}
```

### `POST /api/emergency-stop/resume`

Deactivate the kill switch and resume normal operations.

**Response (200):**
```json
{
  "success": true,
  "message": "Emergency stop deactivated — agents resumed"
}
```

### `GET /api/emergency-stop/status`

Get the current status of the kill switch.

**Response (200):**
```json
{
  "active": true,
  "reason": "Critical vulnerability in sandbox environment",
  "activatedAt": "2025-01-01T00:00:00.000Z",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `EMERGENCY_REDIS_KEY` | `stas:emergency_stop` | Redis key for the kill switch |
| `EMERGENCY_LOCK_FILE` | `/tmp/stas-emergency-stop.lock` | Filesystem lock file path |
| `EMERGENCY_HOLD_QUEUE` | `stas.emergency.hold` | RabbitMQ hold queue name |
| `EMERGENCY_REVOKE_TIMEOUT_MS` | `5000` | SIGTERM→SIGKILL timeout in ms |

## Integration Points

### TypeScript Webhook Server

The middleware can be integrated at multiple points:

1. **Express middleware** — Add to any dispatch route:
   ```ts
   import { emergencyMiddleware } from './emergency/index.js';
   app.post('/dispatch', emergencyMiddleware, dispatchHandler);
   ```

2. **Dispatch wrapper** — Wrap any dispatch function:
   ```ts
   import { wrapDispatch } from './emergency/index.js';
   const safeDispatch = wrapDispatch(originalDispatch);
   ```

3. **BullMQ queue protection** — Protect a BullMQ queue:
   ```ts
   import { protectQueue } from './emergency/index.js';
   const safeQueue = protectQueue(issueQueue);
   ```

### Celery Workers

Connect the signal handler in `celery_app.py`:

```python
from workers.emergency import emergency_prerun
from celery import signals

signals.task_prerun.connect(emergency_prerun)
```

### Linear Notifications

When the kill switch is activated, all active issues tracked by STAS
receive a comment indicating the emergency stop is in effect. This uses
the existing Linear API integration.

## What Happens on Activation

1. **Redis key set** — `stas:emergency_stop` is set with a JSON payload
   containing the reason and timestamp (30-day TTL).
2. **Lock file written** — `/tmp/stas-emergency-stop.lock` is created as a
   filesystem-level indicator.
3. **Prometheus metrics fired** — `stas_emergency_stop_active` set to 1.
4. **Pending messages moved** — All messages in dispatch queues are moved
   to the `stas.emergency.hold` queue.
5. **Linear issues notified** — Active issues receive a notification comment.
6. **Celery tasks rejected** — The `task_prerun` signal handler prevents
   new tasks from starting.
7. **Running tasks revoked** — `revoke_all_agent_tasks()` sends SIGTERM
   to all currently running agent tasks.

## What Happens on Resume

1. **Redis key cleared** — `stas:emergency_stop` is deleted.
2. **Lock file removed** — The lock file is deleted.
3. **Prometheus metric cleared** — `stas_emergency_stop_active` set to 0.
4. **Held messages resumed** — All messages in the hold queue are moved
   back to their original dispatch queues.
5. **Normal operations resume** — New tasks are allowed to start.

## Safety Considerations

- The kill switch persists across restarts (Redis key + lock file).
- Activation is logged at WARN level with full context.
- The Celery middleware has a **whitelist** of system tasks (ping, heartbeat,
  metrics) that always execute, even during emergency stop.
- Deactivation is idempotent — calling it when already inactive is safe.
- The revoke operation sends SIGTERM with a configurable timeout before
  escalating to SIGKILL.

## Testing

```bash
# Unit tests
npx vitest run src/__tests__/emergency/stop.test.ts

# Manual test with curl
curl -X POST http://localhost:3000/api/emergency-stop \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Testing kill switch"}'

# Check status
curl http://localhost:3000/api/emergency-stop/status \
  -H "Authorization: Bearer <ADMIN_API_KEY>"

# Resume
curl -X POST http://localhost:3000/api/emergency-stop/resume \
  -H "Authorization: Bearer <ADMIN_API_KEY>"
```
