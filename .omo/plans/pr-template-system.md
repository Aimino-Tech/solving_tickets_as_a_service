# STAS PR Workflow Template System

Generated: 2026-06-29 | Status: Plan
Team: feasibility-scrutineer, systems-architect, edge-case-hunter, innovation-designer
External research: GWA (GitHub Workflow Agents), RabbitMQ AMQP patterns

---

## Core Architecture

### Two-Level Resolution

```
Level 1 — At job creation (classifier + template resolver):
  Label → Classifier determines request type (bug/coding/planning/open-end)
  → Template resolver selects template
  → Inject thin payload with template name, phases, issue context

Level 2 — At phase execution (worker):
  Worker receives phase message
  → Dynamically resolves CI commands from template store
  → Executes phase with current command definitions
  → Template updates affect in-flight jobs
```

### Key Principle

RabbitMQ just routes opaque messages. It does NOT know about ticket types, templates, or phases. The intelligence lives in:

1. **Classifier service** — resolves label → request type → template
2. **Template store** — `.stas/templates/*.yaml` definitions + dynamic command resolution
3. **Workers** — receive injected payload, resolve commands at execution time

---

## Flow

```
GitHub Issue labeled "stas:fix"
       │
       ▼
  Webhook Handler
       │  1. Verify webhook signature
       │  2. Call classifier → get request type
       │  3. Call template resolver → get matching template
       │  4. Inject job payload with template info + issue context
       │
       ▼
  RabbitMQ (opaque message routing)
       │  Routes to appropriate queue based on exchange bindings
       │  Does NOT inspect message content
       │
       ▼
  Worker
       │  1. Receive injected payload
       │  2. Dynamically resolve CI commands from template store
       │  3. Execute phase steps (pre → main → post → final)
       │  4. Report results
       │
       ▼
  Result → PR / Comment / Memo
```

### Injected Job Payload

```json
{
  "job_id": "uuid",
  "issue": {
    "number": 42,
    "title": "Fix login race condition",
    "body": "...",
    "labels": ["stas:fix", "bug"],
    "repo": "owner/repo"
  },
  "template": {
    "name": "stas:fix",
    "version": 3,
    "phases": ["pre", "main", "post", "final"]
  },
  "classification": {
    "type": "bug",
    "label": "stas:fix",
    "confidence": 0.92
  }
}
```

### Worker Dynamic Resolution

At execution time, the worker:
1. Reads `template.name` from payload
2. Fetches latest template from `.stas/templates/{name}.yaml` / Redis / DB
3. Resolves CI commands for current phase
4. Injects issue context variables into commands
5. Executes each step

Commands are defined per phase in the template YAML:

```yaml
# .stas/templates/fix.yaml
phases:
  pre:
    - command: "opencode grep-memory --query '{issue.summary}'"
      session: reuse
    - command: "opencode plan --issue '{issue.number}'"
      session: new
  main:
    - command: "opencode agent --full-cycle --issue '{issue.number}'"
      session: new
  post:
    - command: "opencode remove-anti-slop --since origin/main"
      session: new
    - command: "opencode release-preview --diff-only"
      session: new
  final:
    - command: "opencode agent --tool write-memory --key 'fix:{issue.number}'"
      session: new
    - command: "opencode agent --mode create-pr"
      session: new
```

---

## Request Type → Template Resolution

| Label Pattern | Request Type | Template | Session Model |
|---|---|---|---|
| `stas:fix` | coding/fix | `fix.yaml` | new for each phase |
| `stas:fix:urgent` | coding/fix | `fix-urgent.yaml` | parallel sessions |
| `stas:plan` | planning | `plan.yaml` | investigation only |
| `stas:research` | open-ended | `research.yaml` | single session |
| any `stas:*` bug | bug | `bug-fix.yaml` | new per phase |
| unknown | fallback | `default.yaml` | single session |

---

## RabbitMQ Topology (Simplified)

```
Exchange: stas.direct (direct, durable)
  ├── Queue: stas.job.pipeline          RK: stas.job.pipeline
  ├── Queue: stas.job.phase.{phase}     RK: stas.job.phase.{phase}
  └── Queue: stas.job.dlq               RK: stas.job.dlq

Retry via DLX:
  stas.retry.30s (TTL=30000ms)
  stas.retry.2m  (TTL=120000ms)
  stas.retry.5m  (TTL=300000ms)
```

RabbitMQ is a thin pipe — it routes opaque messages. No routing per request type or template.

---

## Implementation Plan

### Wave 1: Foundation
1. **Template types + YAML schema** — `src/template/types.ts`, `validator.ts`, `default.yaml`
2. **AMQP connection + exchanges** — `src/queue/amqp/connection.ts`, `exchanges.ts`, `producer.ts`
3. **Template loader + resolver** — `src/template/loader.ts`, `resolver.ts`
4. **Pipeline DB migration** — `pipeline_jobs`, `phase_results`, `agent_sessions` tables

### Wave 2: Orchestration
5. **Classifier + injection** — label → request type → template → inject payload
6. **Workers** — phase execution with dynamic command resolution
7. **Session manager** — OpenCode session lifecycle (create/reuse/close)

### Wave 3: Migration
8. **Remove BullMQ** — switch to RabbitMQ-only
9. **Failure mitigations** — dedup, retry, DLQ, heartbeat, repo lock
10. **E2E tests** — full flow integration tests

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Queue intelligence | RabbitMQ routes opaque messages | Simpler topology, decoupled from ticket types |
| Command resolution | Dynamic at execution time | Template updates affect in-flight jobs |
| Session model | One session per phase by default | Isolation, no state collision |
| Template storage | `.stas/templates/` in repo | Contributed like code, versioned with repo |
