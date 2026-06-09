# Scaling Architecture

> **From a single PC to a Celery fleet to IONOS cloud — without re-architecture.**

This document describes STAS's scaling path across three phases, the architectural invariants that make it possible, and the operational notes for each phase.

## Scaling Path

```
Phase 1 (now)         Phase 2 (growth)          Phase 3 (scale)
──────────────────────────────────────────────────────────────────
1 small PC (4GB)      2-5 small PCs             IONOS cloud VMs
                      (Celery fleet)

┌──────────┐          ┌──────────┐              ┌──────────┐
│  single  │          │  Celery  │              │  IONOS   │
│  Docker  │          │  fleet   │              │  VMs     │
│  daemon  │          │  (each   │              │  (each   │
│  1 bot   │   ───►   │  its own │     ───►     │  bigger  │
│  1 wk    │          │  Docker) │              │  Docker) │
│          │          │  6 queues│              │  S3/NFS  │
└──────────┘          └──────────┘              └──────────┘
```

## Architectural Invariant

> **Every sandbox is stateless. Any worker can pick up any task. No local state on worker machines. Workspaces are ephemeral per-task.**

This single constraint is the foundation of horizontal scaling. Because no worker owns state, adding or removing workers is a pure capacity operation — no data migration, no rebalancing, no quorum changes.

---

## Phase 1: Single Small PC (Current)

### Topology

```
┌─────────────────────────────────────────┐
│             1 small PC (4GB)            │
│                                         │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │  Docker       │  │  OpenCode Serve  │ │
│  │  Compose      │  │  (:4096)         │ │
│  │  (all-in-one) │  └──────────────────┘ │
│  │              │                        │
│  │  ┌─────────┐ │  ┌──────────────────┐ │
│  │  │ Webhook │ │  │  Celery Worker   │ │
│  │  │ (:3000) │ │  │  (1 process)     │ │
│  │  └─────────┘ │  └──────────────────┘ │
│  │              │                        │
│  │  ┌─────────┐ │  ┌──────────────────┐ │
│  │  │ RabbitMQ│ │  │  Redis           │ │
│  │  │ (:5672) │ │  │  (:6379)         │ │
│  │  └─────────┘ │  └──────────────────┘ │
│  └──────────────┘                        │
│                                         │
│  Shared: /var/run/docker.sock           │
└─────────────────────────────────────────┘
```

### Stack

| Component | Role | Container |
|---|---|---|
| `stas-webhook` | Express.js API — receives webhooks, enqueues jobs | Node.js |
| `stas-worker` | Celery worker — executes triage, sandbox, dispatch, verification, PR creation, notifications | Python |
| `celery-beat` | Periodic task scheduler — health checks, DLQ cleanup, metrics | Python |
| `rabbitmq` | Message broker — distributes tasks to workers | Erlang |
| `redis` | Result backend + caching | C |
| `postgres` | Database for the hosted service | C |
| `flower` | Celery monitoring dashboard | Python |
| `opencode-serve` | Agent backend — investigates and fixes issues | Go |

### Resource Allocation

- **Webhook**: 512M RAM, 0.5 CPU
- **Worker**: 1G RAM, 1 CPU (concurrency=4)
- **RabbitMQ/Redis/Postgres**: 256M RAM each
- **OpenCode serve**: Runs outside Docker (native process)
- **Total**: ~3G RAM, ~3 CPU for the stack

### Limits

- ~5-10 concurrent fix runs (limited by OpenCode process memory, ~500MB-2GB per run)
- Webhook throughput: ~200 req/s (limited by Express + rate limiter)
- Single point of failure: RabbitMQ, Redis, Postgres all on one host
- No graceful degradation — if the PC goes down, everything stops

---

## Phase 2: Celery Fleet (Growth)

### Topology

```
                          ┌──────────┐
                          │ RabbitMQ │
                          │ + Redis  │
                          │ + PG     │
                          └────┬─────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  Worker PC 1  │   │  Worker PC 2 │   │  Worker PC N │
   │               │   │              │   │              │
   │  Docker       │   │  Docker      │   │  Docker      │
   │  Daemon       │   │  Daemon      │   │  Daemon      │
   │               │   │              │   │              │
   │  ┌─────────┐  │   │  ┌─────────┐ │   │  ┌─────────┐ │
   │  │ Sandbox │  │   │  │ Sandbox │ │   │  │ Sandbox │ │
   │  │ Pool    │  │   │  │ Pool    │ │   │  │ Pool    │ │
   │  └─────────┘  │   │  └─────────┘ │   │  └─────────┘ │
   │               │   │              │   │              │
   │  GC Sweeper   │   │  GC Sweeper  │   │  GC Sweeper  │
   └──────────────┘   └──────────────┘   └──────────────┘
```

### How It Works

#### RabbitMQ Task Distribution

Tasks are published to one of six Celery queues:

| Queue | Purpose | Routing Key |
|---|---|---|
| `stas.agents.triage` | Issue classification | `stas.agents.triage` |
| `stas.agents.dispatch` | OpenCode agent execution | `stas.agents.dispatch` |
| `stas.agents.sandbox` | Sandbox lifecycle management | `stas.agents.sandbox` |
| `stas.agents.verification` | Test suite verification | `stas.agents.verification` |
| `stas.agents.pr_creation` | GitHub PR creation | `stas.agents.pr_creation` |
| `stas.agents.notifications` | Slack/webhook notifications | `stas.agents.notifications` |

RabbitMQ uses fair dispatch: when a worker becomes available, it receives the next message from any subscribed queue. No affinity or sticky routing — any worker can handle any task.

#### Worker Anatomy

Each worker PC runs:

1. **A Celery worker process** — subscribes to all 6 queues via `celery -A workers.celery_app worker -Q stas.agents.triage,stas.agents.dispatch,...`
2. **A local Docker daemon** — manages sandbox containers for fix execution
3. **A sandbox pool** — pre-warmed Docker containers ready for immediate use
4. **A GC sweeper** — periodically cleans up stale sandbox containers and temp directories

The worker Docker Compose stack (`docker-compose.worker.yml`) is lightweight — just the worker container with `docker.sock` mounted.

#### No Sticky Routing

All queues use the `stas` topic exchange. Any worker subscribed to a queue can pick up a task from it. This means:

- If a task fails on worker A, worker B can retry it
- Workers can be added/removed without any routing table updates
- Task distribution is automatically load-balanced by RabbitMQ
- No worker affinity means no "warm cache" assumption — every task starts fresh

#### Adding a Worker (Zero Downtime)

```bash
# On the new machine:
git clone https://github.com/your-org/stas
docker compose -f docker-compose.worker.yml up -d
```

The new worker connects to the shared RabbitMQ, registers as a consumer for all 6 queues, and immediately starts receiving tasks. No reconfiguration of existing workers needed.

#### Removing a Worker (Zero Downtime)

```bash
# Graceful shutdown:
docker compose -f docker-compose.worker.yml down

# Or: send SIGTERM to the Celery process for in-flight task completion:
celery -A workers.celery_app control shutdown
```

Celery's `worker_shutdown` signal triggers graceful termination: the worker finishes its current tasks (up to `--timeout`), acknowledges or rejects them, then exits. Unprocessed tasks remain in the queue and are picked up by another worker.

### Worker Resource Profile (per PC)

| Resource | Per Worker | Per Sandbox Slot | Notes |
|---|---|---|---|
| RAM | 1G (Celery) | 2G (Docker) | 3G total per worker at 1 concurrent task |
| CPU | 1 core (Celery) | 1 core (Docker) | 1.5 cores reserved for host OS |
| Disk | 10G | 2G (image cache) | ~50G total for OS + images |
| Docker | Required | — | Docker daemon needed for sandbox |

### Recommended Concurrency

```bash
# For a 4GB PC:
STAS_WORKER_CONCURRENCY=2   # 2 parallel tasks
DOCKER_CONTAINER_MEMORY=2g  # 2G per sandbox
DOCKER_CONTAINER_CPU=1      # 1 CPU per sandbox

# For an 8GB PC:
STAS_WORKER_CONCURRENCY=4
DOCKER_CONTAINER_MEMORY=2g
DOCKER_CONTAINER_CPU=1
```

### Operational Notes

- Each worker has its own Docker daemon — no shared Docker socket
- Temp directories are created per-task inside each sandbox and destroyed on cleanup
- The database (Postgres) and message broker (RabbitMQ) remain on dedicated machines or the original PC
- For multi-node, move RabbitMQ/Redis/Postgres to their own VM or use managed services
- OpenCode serve must be reachable via HTTP from all workers (not localhost) — configure `OPENCODE_URL`

---

## Phase 3: IONOS Cloud (Scale)

### Topology

```
                      ┌──────────────┐
                      │  IONOS ALB   │  (optional, for multi-node webhook)
                      └──────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
       │  Webhook VM  │ │  Webhook VM  │ │  Webhook VM  │
       │  (2GB, 1 CPU)│ │  (2GB, 1 CPU)│ │  (2GB, 1 CPU)│
       └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                      ┌────────┴────────┐
                      │  RabbitMQ VM    │
                      │  (4GB, 2 CPU)   │
                      └────────┬────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
       │  Worker VM 1 │ │  Worker VM 2 │ │  Worker VM N │
       │  (8GB, 4 CPU)│ │  (8GB, 4 CPU)│ │  (8GB, 4 CPU)│
       └──────────────┘ └──────────────┘ └──────────────┘
                               │
                      ┌────────┴────────┐
                      │  IONOS S3       │
                      │  (workspace     │
                      │   artifacts)    │
                      └─────────────────┘
```

### IONOS-Specific Services

#### IONOS S3 for Workspace Artifacts

- Store agent workspace outputs (test reports, logs, diffs) in IONOS S3-compatible object storage
- Each task gets a unique S3 prefix: `stas-workspaces/{org}/{repo}/{issue-number}/`
- Artifacts are retained for 30 days, then lifecycle-policy-expired
- S3 replaces the local temp directory for long-lived artifact persistence
- Access via IONOS S3 API (compatible with AWS S3 SDK)

#### IONOS Cloud Panel

- Web UI at https://cloud.ionos.com for VM management
- Create/destroy worker VMs, adjust resources, view metrics
- Pre-configure worker VMs with a startup script that pulls the latest Docker Compose config

#### IONOS Data Center Designer

- Design network topology (VLANs, firewall rules, load balancers)
- Create isolated subnets for worker, broker, and storage traffic
- Configure firewall rules to restrict worker VM outbound access to only:
  - RabbitMQ/Redis endpoints
  - GitHub API
  - LLM provider APIs
  - IONOS S3 endpoint
  - Package registries (npm, PyPI, etc.)

### Migration Path

#### Step 1: Extract Stateful Services

Move RabbitMQ, Redis, and PostgreSQL to dedicated VMs (or use managed services):

```bash
# RabbitMQ VM
ionosctl vm create --name stas-rabbitmq --ram 4096 --cores 2

# Redis VM (or use IONOS managed Redis when available)
ionosctl vm create --name stas-redis --ram 4096 --cores 2

# PostgreSQL VM (or use IONOS managed DB)
ionosctl vm create --name stas-postgres --ram 4096 --cores 2
```

Update worker configurations to point to the new endpoints.

#### Step 2: Provision Worker VMs

Each IONOS worker VM runs the same stack:

```bash
# Launch a worker VM
ionosctl vm create \
  --name stas-worker-1 \
  --ram 8192 \
  --cores 4 \
  --image ubuntu:24.04 \
  --user-data ./deploy/ionos/cloud-init.yaml
```

#### Step 3: Configure S3 Storage

```bash
# Create S3 bucket for workspace artifacts
ionosctl s3 bucket create --name stas-workspaces

# Set lifecycle policy (30-day retention)
ionosctl s3 lifecycle put \
  --bucket stas-workspaces \
  --rule "expire after 30 days"
```

#### Step 4: Optional — Application Load Balancer

If running multiple webhook nodes, configure an IONOS ALB:

```bash
ionosctl alb create \
  --name stas-webhook-alb \
  --listener-protocol HTTPS \
  --listener-port 443 \
  --target-group stas-webhook-targets
```

The ALB terminates TLS and distributes incoming webhooks across webhook VMs.

### Resource Sizing for IONOS VMs

| VM Role | RAM | CPU | Disk | Monthly (est.) |
|---|---|---|---|---|
| Webhook | 2GB | 1 core | 20GB | ~€10 |
| Worker | 8GB | 4 cores | 50GB | ~€40 |
| RabbitMQ | 4GB | 2 cores | 20GB | ~€20 |
| Redis | 4GB | 2 cores | 20GB | ~€20 |
| PostgreSQL | 4GB | 2 cores | 50GB | ~€30 |

Each worker can run 4-8 concurrent sandbox slots depending on task memory requirements.

### Scaling Rules

| Metric | Action |
|---|---|
| Queue depth > 50 for 5 minutes | Add 1 worker VM |
| Queue depth < 10 for 30 minutes | Remove 1 worker VM (min 1) |
| Worker CPU > 80% for 10 minutes | Increase concurrency or add VM |
| S3 storage > 80% | Extend lifecycle policy or increase bucket limit |

---

## Stateless Worker Validation

### Audit Results

| Component | File | Stateful? | Notes |
|---|---|---|---|
| **Docker socket** | `src/sandbox/docker.ts` | ✅ OK | Each worker has its own Docker daemon. Socket mounted per-worker. |
| **Temp directories** | `src/sandbox/docker.ts:141` | ✅ Stateless | `mkdtempSync()` creates temp dir per task; destroyed in `destroy()` (`rmSync` recursive). |
| **E2B sandbox** | `src/sandbox/executor.ts` | ✅ Stateless | Cloud sandbox, fully ephemeral. Destroyed via `sandbox.kill()`. |
| **Queue distribution** | `workers/celeryconfig.py` | ✅ Stateless | RabbitMQ fair dispatch. No sticky routing. Any worker handles any task. |
| **OpenCode URL** | `src/config.ts:69` | ✅ Configurable | `OPENCODE_URL` env var. Workers reach OpenCode via HTTP (not localhost). |
| **Docker host** | `src/sandbox/docker.ts` | ✅ Configurable | `DOCKER_HOST` env var auto-detected by Docker CLI. |
| **Storage** | `src/storage/sqlite.ts` | ⚠️ Per-process | SQLite at `/tmp/stas.db` is per-process, not shared. OK for OSS; use Postgres in fleet. |
| **Worker concurrency** | `src/config.ts:105` | ✅ Configurable | `STAS_WORKER_CONCURRENCY` controls parallel tasks per worker. |
| **Celery concurrency** | `workers/celery_app.py:59` | ✅ Configurable | `WORKER_CONCURRENCY` env var overrides Celery worker concurrency. |
| **Celery broker URL** | `workers/celery_app.py:57` | ✅ Configurable | `CELERY_BROKER_URL` env var for RabbitMQ connection. |
| **Celery result backend** | `workers/celery_app.py:58` | ✅ Configurable | `CELERY_RESULT_BACKEND` env var for Redis connection. |
| **GitHub tokens** | `src/github/auth.ts` | ✅ Stateless | Fetched per-request via GitHub App installation ID. No cached tokens on disk. |
| **Rate limiter state** | `src/ratelimit/` | ⚠️ In-memory | Per-process token buckets. Acceptable — timestamps drift is bounded. |

### Key Findings

1. **No local file system assumptions for long-term storage** — all persistent data goes through Postgres (database) or RabbitMQ/Redis (queue state). SQLite is only used as a lightweight fallback for single-PC deployments.

2. **Workspace directories are fully ephemeral** — temp dirs created with `mkdtempSync()` and destroyed in `destroy()` `finally` block. If a worker crashes mid-task, the temp dir remains orphaned but is cleaned up by the GC sweeper (see AIM-1333).

3. **OpenCode serve must be network-reachable** — in a fleet setup, `OPENCODE_URL` must point to an HTTP endpoint accessible from all workers (not `localhost`). This is already supported by the config system.

4. **Docker socket access is per-worker** — each worker mounts its local `/var/run/docker.sock`. No shared Docker daemon across the fleet. This is the correct isolation model.

---

## Configuration Reference

### Distributed Environment Variables

| Variable | Default | Required For | Config File |
|---|---|---|---|
| `CELERY_BROKER_URL` | `amqp://guest:guest@localhost:5672//` | Phase 2+ | `workers/celery_app.py:57` |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/0` | Phase 2+ | `workers/celery_app.py:58` |
| `OPENCODE_URL` | `http://localhost:4096` | All phases | `src/config.ts:69` |
| `DOCKER_HOST` | `unix:///var/run/docker.sock` | Phase 2+ (auto) | Docker CLI env |
| `DOCKER_CONTAINER_MEMORY` | `4g` | All phases | `src/config.ts:96` |
| `DOCKER_CONTAINER_CPU` | `2` | All phases | `src/config.ts:97` |
| `STAS_WORKER_CONCURRENCY` | `4` | Phase 2+ | `src/config.ts:105` |
| `WORKER_CONCURRENCY` | `4` | Phase 2+ | `workers/celery_app.py:59` |
| `RABBITMQ_URL` | `amqp://localhost:5672/stas` | Phase 2+ | `src/config.ts:57` |
| `REDIS_URL` | `redis://localhost:6379` | All phases | `src/config.ts:47` |
| `DATABASE_URL` | `postgres://localhost:5432/stas` | Phase 2+ | `src/config.ts:179` |
| `STAS_SANDBOX_POOL_MAX_IDLE` | — | Phase 2+ | AIM-1333 |
| `SANDBOX_POOL_SIZE` | `10` | Phase 2+ | `premium/src/routes/dashboard.ts` |

### Per-Machine Tuning

Each worker machine should tune these variables based on its specs:

```bash
# 4GB machine
STAS_WORKER_CONCURRENCY=2
DOCKER_CONTAINER_MEMORY=2g
DOCKER_CONTAINER_CPU=1

# 8GB machine
STAS_WORKER_CONCURRENCY=4
DOCKER_CONTAINER_MEMORY=2g
DOCKER_CONTAINER_CPU=1

# 16GB machine
STAS_WORKER_CONCURRENCY=8
DOCKER_CONTAINER_MEMORY=1g
DOCKER_CONTAINER_CPU=0.5
```

---

## Operations

### Adding a Worker

```bash
# On the new machine:
git clone https://github.com/your-org/stas
cp .env.example .env
# Edit .env with your cluster's broker/backend URLs
docker compose -f docker-compose.worker.yml up -d
```

### Removing a Worker

```bash
# Graceful drain:
docker compose -f docker-compose.worker.yml down

# Or drain Celery first, then stop:
celery -A workers.celery_app control shutdown
docker compose -f docker-compose.worker.yml down
```

### Monitoring

- **Flower**: `http://<worker-ip>:5555` — per-worker task dashboard
- **RabbitMQ Management**: `http://<broker-ip>:15672` — queue depths, consumer counts
- **Prometheus**: Each worker exposes metrics on `:9090/metrics`
- **IONOS Cloud Panel**: VM-level CPU, RAM, disk metrics

### Health Checks

```bash
# Worker liveness
celery -A workers.celery_app inspect ping

# Queue health
curl http://<webhook>:3000/health/queue

# OpenCode reachability
curl http://<opencode-url>:4096/health
```

---

## Design Decisions

### Why RabbitMQ (not Redis pub/sub) for Fleet Communication

Redis pub/sub is fire-and-forget — if a worker is busy, it misses messages. RabbitMQ provides persistent delivery: messages survive broker restarts, are acknowledged after processing, and are re-queued on failure.

### Why Each Worker Has Its Own Docker Daemon

Shared Docker daemons create a single point of failure and a resource contention bottleneck. Each worker managing its own containers provides natural isolation: a runaway sandbox on one worker can't affect another worker's containers.

### Why No Sticky Routing

Sticky routing (e.g., "all tasks for repo X go to worker Y") creates operational complexity: you need to track which worker owns which repo, handle worker failures with rebalancing, and deal with hot shards. The stateless model avoids all of this — any worker can handle any task because no task-local state exists outside the sandbox.
