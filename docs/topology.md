# RabbitMQ Topology

> **Document**: Unified exchange/queue/routing-key topology across TypeScript (Node.js) and Celery (Python) layers.
> **Version**: 1.0.0
> **Last Updated**: 2026-06-25

## Topology

```
Exchange          Type       Queues                              Routing Keys
─────────────────────────────────────────────────────────────────────────────
syntaro.agents       topic      syntaro.agents.dispatch                agent.runner
                             syntaro.agents.verification            agent.verify
                             syntaro.agents.self_audit              agent.self_audit
                             syntaro.agents.sandbox                 agent.sandbox
─────────────────────────────────────────────────────────────────────────────
syntaro.issues       topic      syntaro.issues.triage                  triage.*
                             syntaro.issues.health                  health.*
─────────────────────────────────────────────────────────────────────────────
syntaro.queue        topic      syntaro.queue.pr                       pr.create
                             syntaro.queue.merge                    merge.process
                             syntaro.queue.notifications            queue.notify
─────────────────────────────────────────────────────────────────────────────
syntaro.events       fanout     syntaro.events.event_bus               (fanout)
─────────────────────────────────────────────────────────────────────────────
syntaro.dlx          direct     syntaro.dlx.retry                      dlq.retry
                             syntaro.dlx.failed                     dlq.failed
```

## Dead-Letter Queue (DLQ) Configuration

Every primary queue has a corresponding DLQ under `syntaro.dlx` exchange:

| Primary Queue | DLQ Queue | DLQ Routing Key |
|---|---|---|
| `syntaro.agents.dispatch` | `syntaro.agents.dispatch.dlq` | `syntaro.agents.dispatch` |
| `syntaro.agents.verification` | `syntaro.agents.verification.dlq` | `syntaro.agents.verification` |
| `syntaro.agents.self_audit` | `syntaro.agents.self_audit.dlq` | `syntaro.agents.self_audit` |
| `syntaro.agents.sandbox` | `syntaro.agents.sandbox.dlq` | `syntaro.agents.sandbox` |
| `syntaro.issues.triage` | `syntaro.issues.triage.dlq` | `syntaro.issues.triage` |
| `syntaro.issues.health` | `syntaro.issues.health.dlq` | `syntaro.issues.health` |
| `syntaro.queue.pr` | `syntaro.queue.pr.dlq` | `syntaro.queue.pr` |
| `syntaro.queue.merge` | `syntaro.queue.merge.dlq` | `syntaro.queue.merge` |
| `syntaro.queue.notifications` | `syntaro.queue.notifications.dlq` | `syntaro.queue.notifications` |
| `syntaro.events.event_bus` | `syntaro.events.event_bus.dlq` | `syntaro.events.event_bus` |

Each primary queue is declared with:
- `deadLetterExchange`: `syntaro.dlx`
- `deadLetterRoutingKey`: `<primary-queue-name>`
- `messageTtl`: 24 hours (configurable)

The `syntaro.dlx.retry` queue holds messages eligible for retry.
The `syntaro.dlx.failed` queue holds messages that exceeded max retries.

## Celery Task Routing

| Task Pattern | Target Queue | Exchange |
|---|---|---|
| `workers.tasks.triage.*` | `syntaro.issues.triage` | `syntaro.issues` |
| `workers.tasks.agent.*` | `syntaro.agents.dispatch` | `syntaro.agents` |
| `workers.tasks.sandbox.*` | `syntaro.agents.sandbox` | `syntaro.agents` |
| `workers.tasks.verification.*` | `syntaro.agents.verification` | `syntaro.agents` |
| `workers.tasks.pr_creation.*` | `syntaro.queue.pr` | `syntaro.queue` |
| `workers.tasks.notifications.*` | `syntaro.queue.notifications` | `syntaro.queue` |

## TypeScript Publishing

| Purpose | Exchange | Routing Key | Target Queue |
|---|---|---|---|
| Agent dispatch | `syntaro.agents` | `agent.runner` | `syntaro.agents.dispatch` |
| Triage request | `syntaro.issues` | `triage.request` | `syntaro.issues.triage` |
| Health event | `syntaro.issues` | `health.check` | `syntaro.issues.health` |
| PR create | `syntaro.queue` | `pr.create` | `syntaro.queue.pr` |
| Event broadcast | `syntaro.events` | (fanout) | `syntaro.events.event_bus` |

## Migration Notes

### From Old Topology

The previous topology used:
- **Celery**: exchange `syntaro` (direct) with queues `syntaro.agents.*`, `syntaro.agents.*.dlq`
- **TypeScript**: exchanges `syntaro.agents` (direct), `syntaro.issues` (topic), `syntaro.events` (topic), `syntaro.dlx` (direct)

### Changes Made

1. Celery queues now use domain-specific exchanges instead of shared `syntaro` exchange
2. `syntaro.agents.opencode` queue renamed to `syntaro.agents.dispatch`
3. Routing keys changed from queue-name-based to semantic keys (`agent.runner`, `triage.*`, etc.)
4. DLQ naming follows `<primary-queue>.dlq` convention consistently
5. `syntaro.agents` exchange type changed from `direct` to `topic` for flexible routing
6. `syntaro.events` exchange type changed from `topic` to `fanout` for broadcast semantics

### Verification

After migration:
1. Run `scripts/migrate-topology.sh` to declare the new topology
2. Verify no `UNROUTABLE` messages in RabbitMQ logs
3. Verify TypeScript publishes reach Celery consumers
4. Run `npx vitest run --config vitest.integration.config.ts` for integration tests
