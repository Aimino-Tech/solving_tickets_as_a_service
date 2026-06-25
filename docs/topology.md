# RabbitMQ Topology

> **Document**: Unified exchange/queue/routing-key topology across TypeScript (Node.js) and Celery (Python) layers.
> **Version**: 1.0.0
> **Last Updated**: 2026-06-25

## Topology

```
Exchange          Type       Queues                              Routing Keys
─────────────────────────────────────────────────────────────────────────────
stas.agents       topic      stas.agents.dispatch                agent.runner
                             stas.agents.verification            agent.verify
                             stas.agents.self_audit              agent.self_audit
                             stas.agents.sandbox                 agent.sandbox
─────────────────────────────────────────────────────────────────────────────
stas.issues       topic      stas.issues.triage                  triage.*
                             stas.issues.health                  health.*
─────────────────────────────────────────────────────────────────────────────
stas.queue        topic      stas.queue.pr                       pr.create
                             stas.queue.merge                    merge.process
                             stas.queue.notifications            queue.notify
─────────────────────────────────────────────────────────────────────────────
stas.events       fanout     stas.events.event_bus               (fanout)
─────────────────────────────────────────────────────────────────────────────
stas.dlx          direct     stas.dlx.retry                      dlq.retry
                             stas.dlx.failed                     dlq.failed
```

## Dead-Letter Queue (DLQ) Configuration

Every primary queue has a corresponding DLQ under `stas.dlx` exchange:

| Primary Queue | DLQ Queue | DLQ Routing Key |
|---|---|---|
| `stas.agents.dispatch` | `stas.agents.dispatch.dlq` | `stas.agents.dispatch` |
| `stas.agents.verification` | `stas.agents.verification.dlq` | `stas.agents.verification` |
| `stas.agents.self_audit` | `stas.agents.self_audit.dlq` | `stas.agents.self_audit` |
| `stas.agents.sandbox` | `stas.agents.sandbox.dlq` | `stas.agents.sandbox` |
| `stas.issues.triage` | `stas.issues.triage.dlq` | `stas.issues.triage` |
| `stas.issues.health` | `stas.issues.health.dlq` | `stas.issues.health` |
| `stas.queue.pr` | `stas.queue.pr.dlq` | `stas.queue.pr` |
| `stas.queue.merge` | `stas.queue.merge.dlq` | `stas.queue.merge` |
| `stas.queue.notifications` | `stas.queue.notifications.dlq` | `stas.queue.notifications` |
| `stas.events.event_bus` | `stas.events.event_bus.dlq` | `stas.events.event_bus` |

Each primary queue is declared with:
- `deadLetterExchange`: `stas.dlx`
- `deadLetterRoutingKey`: `<primary-queue-name>`
- `messageTtl`: 24 hours (configurable)

The `stas.dlx.retry` queue holds messages eligible for retry.
The `stas.dlx.failed` queue holds messages that exceeded max retries.

## Celery Task Routing

| Task Pattern | Target Queue | Exchange |
|---|---|---|
| `workers.tasks.triage.*` | `stas.issues.triage` | `stas.issues` |
| `workers.tasks.agent.*` | `stas.agents.dispatch` | `stas.agents` |
| `workers.tasks.sandbox.*` | `stas.agents.sandbox` | `stas.agents` |
| `workers.tasks.verification.*` | `stas.agents.verification` | `stas.agents` |
| `workers.tasks.pr_creation.*` | `stas.queue.pr` | `stas.queue` |
| `workers.tasks.notifications.*` | `stas.queue.notifications` | `stas.queue` |

## TypeScript Publishing

| Purpose | Exchange | Routing Key | Target Queue |
|---|---|---|---|
| Agent dispatch | `stas.agents` | `agent.runner` | `stas.agents.dispatch` |
| Triage request | `stas.issues` | `triage.request` | `stas.issues.triage` |
| Health event | `stas.issues` | `health.check` | `stas.issues.health` |
| PR create | `stas.queue` | `pr.create` | `stas.queue.pr` |
| Event broadcast | `stas.events` | (fanout) | `stas.events.event_bus` |

## Migration Notes

### From Old Topology

The previous topology used:
- **Celery**: exchange `stas` (direct) with queues `stas.agents.*`, `stas.agents.*.dlq`
- **TypeScript**: exchanges `stas.agents` (direct), `stas.issues` (topic), `stas.events` (topic), `stas.dlx` (direct)

### Changes Made

1. Celery queues now use domain-specific exchanges instead of shared `stas` exchange
2. `stas.agents.opencode` queue renamed to `stas.agents.dispatch`
3. Routing keys changed from queue-name-based to semantic keys (`agent.runner`, `triage.*`, etc.)
4. DLQ naming follows `<primary-queue>.dlq` convention consistently
5. `stas.agents` exchange type changed from `direct` to `topic` for flexible routing
6. `stas.events` exchange type changed from `topic` to `fanout` for broadcast semantics

### Verification

After migration:
1. Run `scripts/migrate-topology.sh` to declare the new topology
2. Verify no `UNROUTABLE` messages in RabbitMQ logs
3. Verify TypeScript publishes reach Celery consumers
4. Run `npx vitest run --config vitest.integration.config.ts` for integration tests
