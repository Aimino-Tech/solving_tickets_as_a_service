# Scaling Architecture

> **From a single PC to a Celery fleet to IONOS cloud — without re-architecture.**

This document describes STAS's scaling path across three phases, the architectural invariants that make it possible, and the operational notes for each phase.

> **New in AIM-3208**: This document now includes a detailed **500-user load profile**, **infrastructure requirements**, **cost projection**, **rate limiting calibration**, and **monitoring setup** to guarantee capacity for 500 concurrent users.

---

## 500-User Load Profile (AIM-3208)

### Assumptions

| Parameter | Value | Source |
|---|---|---|
| Total users | 500 | Target capacity |
| Active users (peak) | 150 (30%) | Typical SaaS concurrency |
| Issues per user per day | 2 | GitHub issue creation rate |
| Total issues per day | 1,000 | 500 × 2 |
| Peak issues per hour | 200 | Burst factor of 5× |
| Peak issues per second | 5 | Poisson-distributed arrivals |
| Webhook payload size | ~5 KB | GitHub webhook average |
| Fix duration (p50) | 120s | Measured from production |
| Fix duration (p95) | 300s | Tail latency |
| Fix success rate | 80%+ | SLO target |
| Peak API requests/s | 150 | Dashboard + monitoring probes |
| Concurrent fix runs | 20-40 | Worker pool of 4-8 machines |

### Peak Load Scenarios

#### Scenario 1: Normal Weekday (baseline)
- 500 users active
- ~1,000 issues/day
- ~42 issues/hour sustained
- ~5 concurrent fixes at any time
- 2 worker nodes sufficient

#### Scenario 2: Burst (product launch / incident)
- 150 concurrent users active
- 200 issues/hour for 2 hours
- 20-30 concurrent fixes
- 4-6 worker nodes needed
- Auto-scaling triggers at queue depth > 50

#### Scenario 3: Maximum Peak (DDoS / viral event)
- 500 users all-active
- 500 issues/hour
- 50+ concurrent fixes
- 8-10 worker nodes
- Rate limiting throttles to protect backend
- Queues may back up (target recovery < 30min)

### Capacity Planning Formula

```
Workers needed = (Issues per hour × Fix duration hours) / (Concurrency per worker × Worker uptime)

Example:
  Workers = (200 issues/hr × 0.033 hr (2 min avg fix)) / (4 concurrency × 0.95 uptime)
  Workers = 6.6 / 3.8 = ~2 workers (normal)
  
  Burst:
  Workers = (500 issues/hr × 0.083 hr (5 min p95 fix)) / (4 concurrency × 0.95 uptime)
  Workers = 41.5 / 3.8 = ~11 workers (peak)
```

---

## Infrastructure Requirements

### Minimum (500 users — production)

| Component | Spec | Count | Total RAM | Total CPU |
|---|---|---|---|---|
| stas-webhook | 2GB RAM, 1 CPU | 2 (HA pair) | 4GB | 2 CPU |
| stas-worker | 4GB RAM, 2 CPU | 4 | 16GB | 8 CPU |
| PostgreSQL | 4GB RAM, 2 CPU | 1 | 4GB | 2 CPU |
| RabbitMQ | 2GB RAM, 1 CPU | 1 | 2GB | 1 CPU |
| Redis | 2GB RAM, 1 CPU | 1 | 2GB | 1 CPU |
| Nginx | 512MB RAM, 0.5 CPU | 1 | 512MB | 0.5 CPU |
| **Total** | | **10** | **~28.5GB** | **~14.5 CPU** |

### Recommended (500 users — with headroom)

| Component | Spec | Count | Total RAM | Total CPU |
|---|---|---|---|---|
| stas-webhook | 4GB RAM, 2 CPU | 2 | 8GB | 4 CPU |
| stas-worker | 8GB RAM, 4 CPU | 4 | 32GB | 16 CPU |
| PostgreSQL | 8GB RAM, 4 CPU | 1 (primary) + 1 (replica) | 16GB | 8 CPU |
| RabbitMQ | 4GB RAM, 2 CPU | 1 (mirrored) | 4GB | 2 CPU |
| Redis | 4GB RAM, 2 CPU | 1 (sentinel) | 4GB | 2 CPU |
| Nginx | 1GB RAM, 1 CPU | 2 (HA pair) | 2GB | 2 CPU |
| Prometheus + Grafana | 4GB RAM, 2 CPU | 1 | 4GB | 2 CPU |
| **Total** | | **12** | **~70GB** | **~36 CPU** |

### Database Sizing

For 500 users with PostgreSQL:

| Setting | Value | Reasoning |
|---|---|---|
| `max_connections` | 100 | 20 pool × 5 webhook/worker instances |
| `shared_buffers` | 2GB | 25% of 8GB RAM |
| `effective_cache_size` | 6GB | 75% of 8GB RAM |
| `work_mem` | 32MB | Per-operation sort memory |
| `maintenance_work_mem` | 512MB | For VACUUM, index creation |
| `wal_buffers` | 16MB | Write-ahead log buffer |
| `random_page_cost` | 1.1 | For SSD storage |
| `effective_io_concurrency` | 200 | For SSD storage |

### Network Requirements

| Connection | Bandwidth | Latency Requirement |
|---|---|---|
| Webhook → Nginx | 1 Gbps | < 1ms (same host) |
| Nginx → Webhook app | 1 Gbps | < 1ms (same host) |
| Worker → RabbitMQ | 100 Mbps | < 5ms |
| Worker → PostgreSQL | 100 Mbps | < 5ms |
| Worker → Redis | 100 Mbps | < 5ms |
| Worker → GitHub API | 100 Mbps internet | < 100ms |
| Worker → LLM API | 100 Mbps internet | < 500ms |

---

## Cost Projection

### Monthly Infrastructure Costs

| Provider | Component | Monthly Cost |
|---|---|---|
| **IONOS** | 2 × Webhook VMs (2GB, 1 CPU) | €20 |
| **IONOS** | 4 × Worker VMs (8GB, 4 CPU) | €160 |
| **IONOS** | 1 × PostgreSQL VM (8GB, 4 CPU) | €40 |
| **IONOS** | 1 × RabbitMQ VM (4GB, 2 CPU) | €20 |
| **IONOS** | 1 × Redis VM (4GB, 2 CPU) | €20 |
| **IONOS** | 1 × Nginx VM (1GB, 1 CPU) | €10 |
| **IONOS** | S3 storage (100GB) | €5 |
| **IONOS** | Load balancer | €15 |
| **Subtotal (IONOS)** | | **€290** |

| Provider | Component | Monthly Cost |
|---|---|---|
| **LLM (OpenCode)** | ~10,000 fixes × ~$0.50 avg | $5,000 |
| **GitHub API** | 500 users × free tier | $0 |
| **Sentry** | Error monitoring (100K events) | $29 |
| **Better Stack / Uptime** | Status monitoring | $0 (free tier) |
| **Subtotal (Services)** | | **$5,029** |

### Per-Fix Cost Breakdown

| Component | Cost per Fix |
|---|---|
| LLM (primary: claude-sonnet) | $0.30 - $0.80 |
| LLM (fallback: gpt-4o) | $0.10 - $0.30 |
| Sandbox (E2B / Docker) | $0.01 - $0.05 |
| Infrastructure (amortized) | $0.01 - $0.03 |
| **Total per fix** | **$0.42 - $1.18** |

### Monthly Cost Scenarios

| Scenario | Fixes/Month | LLM Cost | Infrastructure | Total |
|---|---|---|---|---|
| Light (20 users) | 1,200 | $600 | €290 | ~$950 |
| Medium (100 users) | 6,000 | $3,000 | €290 | ~$3,350 |
| **Target (500 users)** | **30,000** | **$15,000** | **€290** | **~$15,350** |
| Heavy (1,000 users) | 60,000 | $30,000 | €580 | ~$30,700 |

### Cost Optimization Strategies

1. **Use cheaper models for triage**: gpt-4o-mini at $0.002/run vs $0.50/run
2. **Set fix timeouts aggressively**: 600s max prevents runaway costs
3. **Cache common fixes**: Simple pattern fixes can be templated
4. **Batch API calls**: Reduce per-request overhead
5. **Use spot/preemptible VMs**: 60-80% cost reduction for worker nodes

---

## Rate Limiting Calibration

### Tier Configuration

| Tier | Per-Repo (req/min) | Per-IP (req/min) | Per-User (req/min) | Concurrency |
|---|---|---|---|---|
| Free | 10 | 30 | 30 | 1 |
| Pro | 50 | 200 | 300 | 3 |
| Enterprise | 200 | 500 | 1000 | 10 |

### Rate Limit Configuration (AIM-3208)

```env
# ── Scaling Rate Limits (AIM-3208) ─────────────────────────────────────
SCALING_RATE_LIMIT_WINDOW_MS=60000
SCALING_RATE_LIMIT_MAX_PER_REPO=100
SCALING_RATE_LIMIT_MAX_PER_IP=500
SCALING_RATE_LIMIT_MAX_PER_USER=1000
```

### Calibration for 500 Users

| Scenario | Required Throughput | Rate Limit Setting | Headroom |
|---|---|---|---|
| Webhooks (GitHub) | 5 req/s | 30 req/s (Nginx) | 6× |
| API (dashboard) | 150 req/s | 100 req/s (Nginx) | 0.67× (scale webhooks) |
| Health checks | 5 req/s | 60 req/m (Nginx) | 12× |
| Per-user (peak) | 10 req/min | 1,000 req/min | 100× |
| Per-IP (GitHub webhooks) | 5 req/s | 100 req/min | 0.33× (per IP burst) |

### Nginx Rate Limiting Zones

```nginx
# In nginx/nginx.conf and nginx/stas.conf:
limit_req_zone $binary_remote_addr zone=stas_webhook:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=stas_api:10m rate=100r/s;
limit_req_zone $binary_remote_addr zone=stas_health:10m rate=60r/m;
```

> **Note**: For 500 users, the API rate limit may need to increase.
> Monitor `rate_limit_blocks_total` in Prometheus and adjust as needed.

---

## Monitoring Setup

### Prometheus Metrics Exposed

| Metric | Type | Labels | Description |
|---|---|---|---|
| `queue_depth` | Gauge | queue, type | Current queue depth (main + DLQ) |
| `tasks_succeeded_total` | Counter | worker, queue | Cumulative successful tasks |
| `tasks_failed_total` | Counter | worker, queue | Cumulative failed tasks |
| `worker_busy_slots` | Gauge | worker | Currently busy worker slots |
| `worker_total_slots` | Gauge | worker | Total worker slots |
| `worker_liveness` | Gauge | worker | 1 if worker is alive |
| `processing_duration_seconds` | Histogram | queue | Task processing duration |
| `fix_run_total` | Counter | status | Total fix runs by status |
| `metering_cost_total` | Counter | component | Cumulative cost in cents |
| `rate_limit_blocks_total` | Counter | tier, reason | Rate-limited requests |
| `webhooks_received_total` | Counter | source | Webhooks received |
| `webhooks_processed_total` | Counter | source | Webhooks processed |
| `scaling_current_workers` | Gauge | - | Current worker count |
| `scaling_max_workers` | Gauge | - | Maximum worker count |
| `scaling_recommendation` | Gauge | type, priority | Scaling recommendation |
| `scaling_events_total` | Counter | type | Scaling events counter |
| `pg_pool_active_connections` | Gauge | - | Active DB connections |
| `pg_pool_idle_connections` | Gauge | - | Idle DB connections |
| `pg_pool_total_connections` | Gauge | - | Max DB connections |

### Prometheus Alert Rules (AIM-3208)

Alert rules are defined in `monitoring/prometheus-alerts.yml`.

| Alert | Condition | Severity | Action |
|---|---|---|---|
| `QueueTooDeep` | queue_depth > 200 for 5m | critical | Add worker replicas |
| `QueueDepthWarning` | queue_depth > 50 for 5m | warning | Monitor, prepare to scale |
| `ErrorRateSpike` | error_rate > 5% for 5m | critical | Investigate worker logs |
| `ErrorRateWarning` | error_rate > 2% for 5m | warning | Investigate |
| `FixRateDrop` | fix_rate < 10% of normal for 5m | critical | Systemic issue |
| `FixRateDegraded` | fix_rate < 50% for 5m | warning | Investigate pipeline |
| `WorkerPoolExhausted` | all workers busy for 5m | critical | Add workers |
| `WorkerPoolHighUtilization` | utilization > 80% for 10m | warning | Scale up soon |
| `DLQMessagesPresent` | dlq > 0 | warning | Investigate failures |
| `HighProcessingLatency` | P95 > 300s for 5m | warning | Check worker health |
| `WorkerDown` | no heartbeat for 120s | critical | Restart worker |
| `DatabasePoolExhaustion` | < 20% connections available | critical | Increase pool max |
| `RateLimitFrequent` | > 10 blocks/s for 5m | warning | Adjust rate limits |
| `ScaleUpRecommended` | queue predicted > 100 in 10m | warning | Proactive scale |

### Grafana Dashboard

The scaling dashboard is at `monitoring/grafana-dashboard.json` and provides:

1. **Queue Depth** — Main issue queue depth with color thresholds
2. **Fix Rate** — Percentage of successful fixes (30min rolling window)
3. **Error Rate** — Task failure percentage (5min window)
4. **Processing Latency (P95)** — P95 task duration by queue
5. **Worker Pool Size** — Active workers, total slots, busy slots
6. **Worker Utilization %** — Overall pool utilization
7. **Cost Per Fix** — Average infrastructure + LLM cost per fix
8. **DLQ Depth** — Dead-letter queue monitoring
9. **Rate Limit Blocks** — Rate limiting activity
10. **Webhook Throughput** — Received vs processed webhooks
11. **Database Pool Utilization** — PostgreSQL connection pool
12. **Scaling Recommendations** — Real-time recommendations table

### Using the Scaling API

```bash
# Get current scaling status
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/api/scaling/status

# Scale up by 1
curl -X POST -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "scale_up", "reason": "Queue depth > 200"}' \
  http://localhost:3000/api/scaling/scale

# Scale to specific count
curl -X POST -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "scale_to", "count": 4, "reason": "Planned capacity increase"}' \
  http://localhost:3000/api/scaling/scale

# Get scaling recommendations
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  http://localhost:3000/api/scaling/recommendations
```

---

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
| Queue depth > 200 for 5 minutes | Add 1 worker VM (critical) |
| Queue depth > 50 for 5 minutes | Add 1 worker VM (warning) |
| Queue depth < 10 for 30 minutes | Remove 1 worker VM (min 1) |
| Worker CPU > 80% for 10 minutes | Increase concurrency or add VM |
| S3 storage > 80% | Extend lifecycle policy or increase bucket limit |
| Error rate > 5% for 5 minutes | Investigate worker health |
| P95 latency > 300s for 5 minutes | Check worker capacity |

---

## Load Testing

### k6 Load Tests

Load test scripts are in `scripts/load-test/`:

| Script | What It Tests | VUs | Duration |
|---|---|---|---|
| `webhook.js` | GitHub webhook delivery | 50 | 5m |
| `api.js` | API endpoint throughput | 20 | 5m |
| `db.js` | Database concurrent reads/writes | 50 | 3m |
| `run.sh` | Orchestrator (runs all) | configurable | configurable |

### Running Load Tests

```bash
# Run all load tests against local dev
./scripts/load-test/run.sh

# Run against staging with admin API key
./scripts/load-test/run.sh \
  --target https://staging.stas.dev \
  --api-key your-admin-key \
  --duration 10m \
  --vu 100 \
  --api-vu 50 \
  --db-vu 100

# Run individual test
k6 run scripts/load-test/webhook.js \
  --env TARGET_URL=https://staging.stas.dev/webhook \
  --env VU=50 \
  --env DURATION=5m
```

### Expected Thresholds

| Test | Metric | Target |
|---|---|---|
| Webhook | p95 latency | < 2000ms |
| Webhook | Error rate | < 1% |
| Webhook | Throughput | > 50 req/s sustained |
| API | p95 latency | < 1000ms |
| API | Error rate | < 0.5% |
| DB reads | p95 latency | < 500ms |
| DB writes | p95 latency | < 1000ms |
| DB | Error rate | < 1% |

---

## Scaling Verification

Run the scaling verification script to check all components:

```bash
# Run all checks
./scripts/scale-verify.sh

# Check specific compose file and target
./scripts/scale-verify.sh \
  --compose-file docker-compose.prod.yml \
  --target https://staging.stas.dev \
  --scale 4 \
  --db-pool-max 20

# Skip Docker checks (CI environment)
./scripts/scale-verify.sh --skip-docker
```

The verification script checks:

1. **Docker Compose** — validates service definitions, no `container_name` on scalable services
2. **PostgreSQL** — verifies `DATABASE_POOL_MAX` and `SCALING_PG_POOL_MAX` configuration
3. **Nginx** — validates upstream blocks, rate limiting zones, worker connections
4. **Health endpoints** — checks `/health`, `/health/ready`, `/health/queue`, `/metrics`
5. **Queue config** — verifies RabbitMQ queues, DLQ settings, worker concurrency
6. **Monitoring** — checks Grafana dashboard, Prometheus alert rules

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

### Scaling Environment Variables (AIM-3208)

| Variable | Default | Description |
|---|---|---|
| `SCALING_MAX_WORKERS` | `10` | Maximum worker replicas allowed |
| `SCALING_PG_POOL_MAX` | `20` | PostgreSQL connection pool max |
| `SCALING_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (1 minute) |
| `SCALING_RATE_LIMIT_MAX_PER_REPO` | `100` | Max requests per repo per window |
| `SCALING_RATE_LIMIT_MAX_PER_IP` | `500` | Max requests per IP per window |
| `SCALING_RATE_LIMIT_MAX_PER_USER` | `1000` | Max requests per user per window |
| `SCALING_DLQ_MAX_SIZE` | `1000` | Dead-letter queue max messages |
| `SCALING_DLQ_NOTIFY_AT` | `100` | DLQ notification threshold |

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

## Development Mode (Plan B)

For fast local experimentation and CI, STAS supports a containerless development mode
that avoids spinning up the full production stack.

### When to use Plan B

| Use Case | Plan A (prod) | Plan B (dev) |
|---|---|---|
| Full sandbox testing | ✅ Required | ❌ No sandbox |
| Triage / notification tasks | ✅ Works | ✅ Works |
| Debugging a Celery task | ✅ Works | ✅ Faster |
| CI for non-sandbox tests | ❌ Overkill | ✅ Lightweight |
| Quick iteration on worker code | ❌ Slow rebuild | ✅ Instant |

### Setup

```bash
# 1. Start minimal infra (Redis + RabbitMQ only)
make dev-infra

# 2. Run the webhook directly on host
make dev-webhook

# 3. Run Celery worker directly on host
make dev-worker QUEUE=triage,dispatch,verification,pr_creation,notifications
```

### Limitations

- **No Docker sandbox** — sandbox tasks (`stas.agents.sandbox`) will fail with
  `"E2B_API_KEY not configured"`. This is intentional.
- **No sandbox-svc** — the `SANDBOX_SVC_URL` environment variable is not set,
  so sandbox-proxy tasks are also unavailable.
- **Host dependencies** — requires Python 3.11+ with pip, Node.js 20+, and a
  local Redis/RabbitMQ (provided via `make dev-infra` Docker containers).

### Architecture

```
Host (Plan B)
┌─────────────────────────────────────────┐
│  make dev-infra          make dev-webhook│
│  ┌──────────┐  Redis    ┌────────────┐  │
│  │  Docker  │◄─────────►│  Express   │  │
│  │  Redis   │           │  :3000     │  │
│  │  Rabbit  │◄──AMQP───►│            │  │
│  └──────────┘           └────────────┘  │
│                              │           │
│                    ┌─────────▼────────┐  │
│                    │  Celery Worker   │  │
│                    │  (host process)  │  │
│                    │  :9090 metrics   │  │
│                    └──────────────────┘  │
│                          │               │
│                    (no sandbox —         │
│                     sandbox tasks fail)  │
└─────────────────────────────────────────┘
```

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
- **Grafana**: `http://<monitoring-ip>:3000` — scaling & capacity dashboard

### Health Checks

```bash
# Worker liveness
celery -A workers.celery_app inspect ping

# Queue health
curl http://<webhook>:3000/health/queue

# OpenCode reachability
curl http://<opencode-url>:4096/health

# Scaling status
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://<webhook>:3000/api/scaling/status
```

---

## Design Decisions

### Why RabbitMQ (not Redis pub/sub) for Fleet Communication

Redis pub/sub is fire-and-forget — if a worker is busy, it misses messages. RabbitMQ provides persistent delivery: messages survive broker restarts, are acknowledged after processing, and are re-queued on failure.

### Why Each Worker Has Its Own Docker Daemon

Shared Docker daemons create a single point of failure and a resource contention bottleneck. Each worker managing its own containers provides natural isolation: a runaway sandbox on one worker can't affect another worker's containers.

### Why No Sticky Routing

Sticky routing (e.g., "all tasks for repo X go to worker Y") creates operational complexity: you need to track which worker owns which repo, handle worker failures with rebalancing, and deal with hot shards. The stateless model avoids all of this — any worker can handle any task because no task-local state exists outside the sandbox.
