# SYNTARO Sandbox Redesign — Efficient Self-Hosted Sandbox

## Why

Current Docker sandbox (`src/sandbox/docker.ts`, 820 lines) uses `spawnSync`, defaults to **4GB/2CPU**, runs as root, and has no resource pooling. On small PCs this burns hardware. The E2B-first design also means self-hosted users get suboptimal defaults.

**User requirement**: "it should be very very efficient, otherwise, we burn our hardware too fast, too crazy. we just have some small pcs in the beginning for now"

**Scaling path**: Single small PC → a few more PCs with Celery fleet → IONOS cloud VMs at scale. Everything is stateless: any worker picks up any task.

## Scaling architecture

```
Phase 1 (now)         Phase 2 (growth)          Phase 3 (scale)
──────────────────────────────────────────────────────────────────
1 small PC (4GB+)     2-5 small PCs             IONOS cloud VMs
                      (Celery fleet)

┌──────────┐          ┌──────────┐              ┌──────────┐
│ 1 box    │          │  Celery  │              │  IONOS   │
│ Docker   │          │  fleet   │              │  VMs     │
│ + all    │          │  (each   │              │  (each   │
│ services │   ───►   │  its own │     ───►     │  bigger  │
│ RabbitMQ │          │  Docker) │              │  Docker) │
│ Redis    │          │  6 queues│              │  S3/NFS  │
└──────────┘          └──────────┘              └──────────┘
```

### Architecture decision: HTTP bridge for Docker management

**The critical insight**: Sandbox management (Docker pool, GC) is Node.js/TypeScript. Celery workers are Python. These cannot share code. The solution:

```
┌─────────────────────┐      HTTP       ┌──────────────────┐
│ Python Celery       │  ────────────►   │ syntaro-sandbox-svc │
│ Worker (pipelines)  │                 │ (Node.js, :4097)│
│                     │  ◄────────────   │                  │
│ docker.sock: ❌     │                 │ docker.sock: ✅  │
└─────────────────────┘                 └──────────────────┘
```

The **sandbox microservice** (`syntaro-sandbox-svc`) runs on each worker machine:
- HTTP API on `:4097`
- Owns the Docker socket
- Manages warm pool, container lifecycle, GC, repo bootstrapping
- Celery workers call it via HTTP (no shared code needed)

### API contract

```
POST /sandbox/acquire → { containerId, workdir, status }
POST /sandbox/release ← { containerId }
POST /sandbox/boot    → { repoUrl, token?, branch? } → { containerId, workdir, runtime }
POST /sandbox/exec    → { containerId, cmd, timeout? } → { stdout, stderr, exitCode }
POST /sandbox/destroy ← { containerId }
POST /sandbox/gc      → { cleaned: number }
GET  /sandbox/status  → { poolSize, idle, inUse, uptime }
```

**Why `POST /sandbox/boot`?** Repo lifecycle is non-trivial: git clone (auth, depth=1), runtime detection (check for package.json, requirements.txt, go.mod, Cargo.toml, etc.), dependency installation. This wraps the existing 820 lines of `docker.ts` logic into a single HTTP call instead of making Python re-implement it across 10+ API calls.

**Cleanup old code**: After sandbox-svc is deployed and tested, DELETE `src/sandbox/docker.ts` and remove the Docker branch from `src/sandbox/index.ts`. The old code is dead — the Celery pipeline doesn't use it, and keeping two active Docker sandbox implementations causes confusion about which is authoritative.

### Phase architecture

**Phase 1 — Single small PC (now):**
```
services:
  syntaro-webhook:        # Express, publishes to queue
  syntaro-sandbox-svc:    # NEW — Node.js Docker manager
  syntaro-worker:          # Python Celery, calls sandbox-svc via HTTP
  syntaro-opencode:        # OpenCode serve (containerized)
  redis:
  rabbitmq:
  syntaro-egress-proxy:    # NEW — Squid for network isolation
  nginx:                # optional
```

Worker concurrency: split short-lived queues from long-lived ones:
```bash
# Worker process 1 — long-running (sandbox, dispatch, verification)
celery -A workers.celery_app worker -Q syntaro.agents.dispatch,syntaro.agents.sandbox,syntaro.agents.verification --concurrency=1

# Worker process 2 — short-running (triage, PR creation, notifications)
celery -A workers.celery_app worker -Q syntaro.agents.triage,syntaro.agents.pr_creation,syntaro.agents.notifications --concurrency=2
```

This prevents a 10-minute sandbox task from blocking a 2-second PR creation task.

**Phase 2 — Celery fleet (growth):**
- RabbitMQ/Redis stay on one machine (or managed)
- Each worker machine: `syntaro-sandbox-svc` + `syntaro-worker` (points to remote RabbitMQ)
- Docker socket only in sandbox-svc

**Phase 3 — IONOS cloud (scale):**
- Same architecture, bigger VMs
- RabbitMQ/Redis as managed services
- Optional: S3 for workspace artifacts, NFS for shared cache

## Plan B: Containerless Celery/RabbitMQ for fast local dev

When you want to experiment fast without Docker on the worker side:

```
┌───────────────────────────────────────────────────┐
│ Host machine                                      │
│                                                    │
│  npm run dev:webhook (Express, publishes to Redis) │
│  pip install -r requirements.txt                   │
│  celery -A workers.celery_app worker ...           │
│  # RabbitMQ/Redis: installed locally or Docker     │
│                                                    │
│  ❌ No sandbox-svc (no Docker sandbox)             │
│  ❌ No egress proxy                                │
│  ✅ Fastest iteration cycle                        │
└───────────────────────────────────────────────────┘
```

**When to use Plan B:**
- Early development and testing of new worker tasks
- Debugging Celery task logic without Docker compose overhead
- Running on developer laptops that don't need full isolation
- CI/CD pipelines where Docker-in-Docker is too heavy

**When to use Plan A (Docker):**
- Any fix that involves running untrusted code (the whole point of SYNTARO)
- Production / staging deployments
- Multi-tenant scenarios
- When you need network isolation

**Implementation**:
- `pip install -r workers/requirements.txt` locally (not in Docker)
- `celery -A workers.celery_app worker -l info -Q syntaro.agents.triage,syntaro.agents.dispatch,syntaro.agents.sandbox,syntaro.agents.verification,syntaro.agents.pr_creation,syntaro.agents.notifications --concurrency=2`
- RabbitMQ/Redis can run in Docker or be installed locally (apt/brew)
- Sandbox tasks fall back to E2B or throw (no local Docker = no sandbox-svc)
- Create a `docker-compose.dev.yml` with just redis + rabbitmq (no workers, no webhook)
- Add a `Makefile` target: `make dev-worker` that runs the Celery worker directly

```yaml
# docker-compose.dev.yml — lightweight infra for Plan B
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    mem_limit: 128m

  rabbitmq:
    image: rabbitmq:3-alpine
    ports: ["5672:5672", "15672:15672"]
    mem_limit: 256m
```

```makefile
# Makefile additions
dev-infra:  # Start only Redis + RabbitMQ (Docker)
	docker compose -f docker-compose.dev.yml up -d

dev-worker:  # Run Celery worker directly (no sandbox-svc)
	pip install -r workers/requirements.txt
	celery -A workers.celery_app worker -l info -Q syntaro.agents.$(QUEUE) --concurrency=2

dev-webhook:  # Run webhook directly
	npm run dev
```

## Guiding principles

1. **Default conservative** — ship with settings that work on 4GB RAM / 2-core machines
2. **Stateless workers** — any Celery worker can pick up any task; no sticky routing
3. **Hard limits, not suggestions** — pids-limit, ulimit, OOM scores, stop timeouts
4. **Zero trust networking** — agent containers get minimum egress (no `NET_ADMIN`/`NET_RAW`)
5. **HTTP bridge** — Node.js microservice owns Docker, Python calls via API
6. **Predictable cleanup** — finally-based teardown + GC sweep
7. **Containerless Plan B** — fast dev loop without Docker sandbox overhead

## What changes

### A. Docker sandbox resource defaults (config.ts)

```
Current                  →  New
──────────────────────────────────────────────
DOCKER_CONTAINER_MEMORY: '4g'   →  '2g'
DOCKER_CONTAINER_CPU: 2         →  1
DOCKER_IMAGE: 'ubuntu:24.04'   →  'ubuntu:24.04' (UNCHANGED)
```

**Why revert from `node:22-alpine`?** The sandbox runtime detection in docker.ts supports Python, Go, Rust, Ruby, Java, PHP, Swift, Dart, Elixir, C++, C#. An Alpine image has only Node.js — every `python3`, `go`, `javac` command would fail. Ubuntu 24.04 is the safe default. The 75MB image size difference is negligible (cached after first pull). Users with Node.js-only workflows can set `DOCKER_IMAGE=node:22-alpine` in config.

Resource rationale:
- **2GB** covers the P95 memory for test runs (research: 185MB baseline, 518MB pytest P95, 2GB peak for Node.js tool call bursts — 4GB is wasteful for small repos)
- **1 CPU** is enough for the pre/post phases (baseline tests, static analysis, verification)
- **8GB machine recommended minimum**. On 4GB, set `DOCKER_CONTAINER_MEMORY=1g`. Total on 4GB: ~3.7GB used (see budget table), leaving 300MB headroom — tight but workable with conservative settings.

#### QA: Config defaults
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | grep | Verify `DOCKER_CONTAINER_MEMORY` defaults to `'2g'` in `src/config.ts` | Match exists |
| 2 | grep | Verify `DOCKER_CONTAINER_CPU` defaults to `1` in `src/config.ts` | Match exists |
| 3 | grep | Verify `DOCKER_IMAGE` still defaults to `'ubuntu:24.04'` in `src/config.ts` | Unchanged |
| 4 | bash | `docker run --rm ubuntu:24.04 python3 --version && node --version` | Both work |

### B. Hardened container create args (sandbox-svc)

Migrate Docker operations from spawnSync CLI calls to spawnSync (keep CLI pattern, NOT dockerode — avoids new dependencies). The existing `docker.ts` spawnSync pattern works fine; the microservice just wraps it in an HTTP API.

```typescript
// NEW args to add in buildCreateArgs():
args.push('--pids-limit', '256');          // prevent fork bombs
args.push('--ulimit', 'nofile=1024:1024'); // prevent FD exhaustion
args.push('--ulimit', 'nproc=512:512');    // prevent process storms
args.push('--stop-timeout', '5');          // fast SIGKILL after SIGTERM

// ⚠️  Do NOT use --user flag here! The target user (UID 10001) does not exist
// in ubuntu:24.04 at container start time. Using --user 10001:10001 would
// cause 'docker start' to fail with "unable to find user 10001".
// Instead: container starts as root, then the boot script creates the user
// (useradd -m -u 10001 agent), and all docker exec calls use -u 10001:10001.

// Remove powerful caps:
// REMOVE: --cap-add NET_ADMIN NET_RAW
```

**UID approach**: `ubuntu:24.04` has no non-root user by default. The fix:
1. Start container as root (no `--user` flag)
2. In `POST /sandbox/boot`, run: `groupadd -g 10001 syntaro && useradd -u 10001 -g syntaro -m agent`
3. All `POST /sandbox/exec` calls use: `docker exec -u 10001:10001 <containerId> <cmd>`
4. Root-only operations (package installs, git pushes) happen directly in docker exec as root when needed

**tmpfs warning**: `--tmpfs /tmp:size=2g` inside a `--memory 2g` container causes OOM. The tmpfs allocation counts against the memory cgroup. Use `--tmpfs /tmp:size=${Math.max(512, Math.floor(memoryLimitInGb * 0.5))}m` — no more than 50% of the memory limit.

**Graceful shutdown**: sandbox-svc must handle SIGTERM to clean up warm pool containers:
```typescript
process.on('SIGTERM', async () => {
  await pool.drain();    // Destroy idle containers
  await server.close();  // Stop accepting requests
  process.exit(0);
});
```

**Docker overlay2 overhead**: Expect ~100MB per container for the overlay2 filesystem + ~50MB for image layers. With 1-2 sandbox containers, add ~200MB to resource budget. Already accounted for in the budget table (Docker daemon 200MB includes this).

#### QA: Hardened args
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | grep | Verify `--pids-limit` is in `buildCreateArgs` | Match exists |
| 2 | grep | Verify `--ulimit nofile=` in `buildCreateArgs` | Match exists |
| 3 | grep | Verify `--ulimit nproc=` in `buildCreateArgs` | Match exists |
| 4 | grep | Verify `--stop-timeout` in `buildCreateArgs` | Match exists |
| 5 | grep | Verify `NET_ADMIN` is **NOT** in `buildCreateArgs` | No match |
| 6 | grep | Verify `NET_RAW` is **NOT** in `buildCreateArgs` | No match |
| 7 | bash | `docker create` with args (no --user flag), `docker start`, useradd in boot, then `docker exec -u 10001:10001 id` | uid=10001(gid=10001) |

### C. Replace iptables with egress proxy

**Problem**: Current code requires `--cap-add NET_ADMIN NET_RAW` for iptables inside container. If the agent exploits a kernel vuln, these caps enable container escape.

**Solution**: Squid proxy container with domain allowlisting. Agent containers route through it.

```yaml
# docker-compose addition
services:
  syntaro-egress-proxy:
    image: sameersbn/squid:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3128:3128"
    volumes:
      - ./docker/squid/squid.conf:/etc/squid/squid.conf:ro
    mem_limit: 128m
    cpus: 0.25
```

`squid.conf` generated from `DOCKER_ALLOWED_HOSTS` config at service start.

**Squid bypass mitigation**: Add host-level iptables rules to DROP all egress from `syntaro_agent-net` EXCEPT:
- TCP to `syntaro-egress-proxy:3128` (the proxy itself)
- DNS UDP to known resolvers (e.g., `8.8.8.8:53`)

```bash
iptables -A FORWARD -i syntaro_agent-net -j DROP
iptables -A FORWARD -i syntaro_agent-net -o docker0 \
  -p tcp --dport 3128 -d syntaro-egress-proxy-ip -j ACCEPT
iptables -A FORWARD -i syntaro_agent-net -p udp --dport 53 \
  -d 8.8.8.8,1.1.1.1 -j ACCEPT
```

This prevents DNS tunneling and non-proxy direct connections.

#### QA: Egress proxy
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | bash | Start egress proxy: `docker compose up -d syntaro-egress-proxy` | Container running |
| 2 | bash | Boot test container with proxy: `curl -v https://api.github.com` | 200 OK |
| 3 | bash | Test blocked domain: `curl -v https://evil.com` | 403/connection refused |
| 4 | bash | Test DNS tunnel: `dig @8.8.8.8 evil.com` | Blocked by iptables |
| 5 | grep | No `NET_ADMIN`/`NET_RAW` in `buildCreateArgs` | Confirmed |

### D. Warm sandbox pool — as HTTP microservice (NEW: `sandbox-svc/`)

**This is the key architectural decision**. The pool is NOT a TypeScript class called from Python Celery. It's a standalone Node.js microservice with an HTTP API.

#### Files

```
sandbox-svc/
  package.json         # Express + typescript + tsx/watch
  Dockerfile            # Build + run
  tsconfig.json
  src/
    index.ts           # Express server on :4097
    pool.ts            # SandboxPool class
    gc.ts              # SandboxGC periodic sweeper
    docker.ts          # Docker operations (adapted from src/sandbox/docker.ts)
```

#### Pool design

```typescript
export class SandboxPool {
  private container: Docker.ContainerInfo | null = null;
  private maxIdle = 1;    // small PC → 1 warm
  private maxTotal = 2;   // cap
  private ttlMs = 300_000; // 5 min idle → destroy (pool cleans known idle)

  async acquire(): Promise<ContainerInfo> {
    // If warm container exists and is healthy → return it
    // Otherwise → create new (capped at maxTotal)
    // Return { containerId, workdir }
  }

  async release(containerId: string): Promise<void> {
    // If pool has room → reset (clean files, git checkout --force) and keep warm
    // Otherwise → destroy
  }
}
```

**Pool vs GC separation**: The pool destroys idle containers after 5 min (its own TTL). The GC (below) only catches **orphans** — leaked containers where release() was never called (process crash, unhandled error). So they don't overlap: pool handles known idle, GC handles unknown orphans.

#### HTTP API

```
POST /sandbox/acquire → { containerId, workdir, createdAt }
POST /sandbox/release → { containerId, ok: true }
POST /sandbox/boot    → { repoUrl, token?, branch? } → { containerId, workdir, runtime }
POST /sandbox/exec    → { containerId, cmd, timeout? } → { stdout, stderr, exitCode }
POST /sandbox/destroy → { containerId, ok: true }
POST /sandbox/gc      → { cleaned: number }
GET  /sandbox/status  → { pool: { idle, inUse, maxIdle, maxTotal }, uptime, gcStats }
```

**`POST /sandbox/boot` details**: Wraps the existing `DockerSandbox.boot()` flow:
1. Create container from warm pool (or fresh)
2. Clone repo: `git clone --depth 1 --branch <branch> https://<token>@<repoUrl>`
3. Detect runtime: check for `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.
4. Install dependencies: `npm ci` / `pip install -r requirements.txt` / `go mod download` / etc.
5. Return `{ containerId, workdir, runtime }`

#### Call from Python Celery

```python
import httpx

class SandboxServiceClient:
    def __init__(self, base_url=None):
        # Configurable via env var, NOT hardcoded localhost
        self.base_url = base_url or os.environ.get(
            "SANDBOX_SVC_URL", "http://syntaro-sandbox-svc:4097"
        )
        self.client = httpx.Client(base_url=self.base_url)

    def acquire(self):
        resp = self.client.post("/sandbox/acquire", timeout=30)
        resp.raise_for_status()
        return resp.json()

    def release(self, container_id):
        self.client.post("/sandbox/release", json={"containerId": container_id})

    def boot(self, repo_url, token=None, branch=None):
        body = {"repoUrl": repo_url}
        if token:
            body["token"] = token
        if branch:
            body["branch"] = branch
        resp = self.client.post("/sandbox/boot", json=body, timeout=300)
        resp.raise_for_status()
        return resp.json()

    def exec(self, container_id, cmd, timeout=120):
        resp = self.client.post("/sandbox/exec", json={
            "containerId": container_id,
            "cmd": cmd,
            "timeout": timeout
        }, timeout=timeout + 10)
        # Handle timeout response
        if resp.status_code == 408:
            raise TimeoutError(f"Command timed out after {timeout}s")
        return resp.json()
```

**Why not hardcode `localhost:4097`?** In Docker compose, containers resolve each other by service name (`syntaro-sandbox-svc:4097`), not `localhost:4097`. The env var allows configurable hostname.

#### QA: Warm pool
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | bash | Build + start sandbox-svc | Server listening on :4097 |
| 2 | bash | `curl -X POST http://localhost:4097/sandbox/acquire` | Returns containerId |
| 3 | bash | `curl -X POST http://localhost:4097/sandbox/acquire` | Same containerId (warm reuse) |
| 4 | bash | `curl -X POST http://localhost:4097/sandbox/boot -d '{"repoUrl":"https://github.com/user/repo"}'` | Returns containerId + workdir + runtime |
| 5 | bash | `curl -X POST http://localhost:4097/sandbox/status` | Shows pool metrics |
| 6 | integration | Python calls `SandboxServiceClient().acquire()` | HTTP 200, valid JSON |

### E. GC sweeper (part of sandbox-svc)

GC runs inside the sandbox-svc process, not as a Celery task. Triggered in two ways:

1. **Internal timer**: runs `sweep()` every 5 minutes in the background
2. **API trigger**: `POST /sandbox/gc` — called by Celery Beat if desired

**Celery broker reconnection**: Add to Celery config to survive RabbitMQ network blips:
```python
# In workers/celeryconfig.py, add:
broker_connection_retry_on_startup = True
broker_connection_max_retries = 0    # 0 = infinite retry
worker_lost_wait = 60                # seconds before declaring worker lost
```

Celery Beat schedule addition (for heartbeat GC):
```python
# In workers/celeryconfig.py, append to beat_schedule:
beat_schedule = {
    # ... existing tasks ...
    'sandbox_gc_trigger': {
        'task': 'tasks.sandbox_gc_trigger',  # NEW: lightweight task
        'schedule': 300.0,  # every 5 minutes
    },
}
```

```python
# workers/tasks/sandbox_gc.py (NEW)
import httpx

@app.task
def sandbox_gc_trigger():
    """Call sandbox-svc GC endpoint periodically."""
    client = httpx.Client(base_url=os.environ.get("SANDBOX_SVC_URL"))
    resp = client.post("/sandbox/gc", timeout=30)
    return resp.json()
```

```typescript
// sandbox-svc/src/gc.ts
export class SandboxGC {
  async sweep(): Promise<number> {
    // List containers with label syntaro-sandbox=true
    // Older than 10 minutes (configurable, default 10 min)
    // → force destroy (docker stop + docker rm -v)
    // Clean syntaro_agent-net network if no containers remain
  }

  start(): void {
    setInterval(() => this.sweep(), 300_000); // 5 min internal GC
  }
}
```

**Pool TTL vs GC sweep**: The pool's `release()` cleans up properly (returns container to warm pool or destroys it). The GC only catches **orphans** — containers where the pool's release was never called because the calling process crashed or an unhandled error occurred. They have different jobs.

#### QA: GC sweeper
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | grep | Verify sandbox-svc labels containers with `syntaro-sandbox=true` during create | Label applied |
| 2 | integration | Force-kill sandbox-svc parent, restart, call `POST /sandbox/gc` | Orphan container removed |
| 3 | integration | Verify GC cleans containers older than 10 min, not newer ones | Correct age filtering |
| 4 | bash | `curl -X POST http://localhost:4097/sandbox/gc` | Returns `{ cleaned: N }` |

### F. Task-level watchdog timer (sandbox-svc)

Watchdog lives at the sandbox microservice level. Each exec call enforces a timeout:

```typescript
// sandbox-svc: exec endpoint
app.post('/sandbox/exec', async (req, res) => {
  const { containerId, cmd, timeout } = req.body;
  const effectiveTimeout = timeout ?? 600_000; // 10 min default

  try {
    // Use spawnSync with built-in timeout (not AbortController — 
    // spawnSync doesn't support AbortSignal. The 'timeout' option 
    // kills the child process on timeout.)
    const result = spawnSync('docker', ['exec', containerId, ...cmd], {
      timeout: effectiveTimeout,
      encoding: 'utf-8'
    });
    res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status,
      timedOut: result.signal === 'SIGTERM'
    });
  } catch (err) {
    if (err.killed || err.signal) {
      res.status(408).json({ error: 'Timeout', containerId });
    }
  }
});
```

Additionally, the Python Celery task has a client-side timeout and destroys on completion:

```python
# In celery worker task:
async def handle_fix(issue_data):
    sandbox = SandboxServiceClient()
    info = None
    try:
        info = sandbox.boot(
            repo_url=issue_data['repo_url'],
            token=issue_data.get('token'),
            branch=issue_data.get('branch')
        )
        result = sandbox.exec(
            info['containerId'],
            cmd="./run_tests.sh",
            timeout=600
        )
        return result
    except TimeoutError:
        logger.error("Task timed out")
        raise
    finally:
        if info and 'containerId' in info:
            sandbox.release(info['containerId'])  # Returns to pool or destroys
```

#### QA: Task watchdog
| Step | Tool | Action | Expected |
|---|---|---|---|
| 1 | integration | Call `/sandbox/exec` with `timeout=1`, cmd that sleeps 10s | 408 Timeout after ~1s |
| 2 | integration | Verify container is still alive after timeout (pool handles cleanup on release) | Container exists |
| 3 | integration | Verify `finally` block always calls `sandbox.release()` | Always released |

### G. OpenCode serve containerization

Currently OpenCode serve runs manually on the host (no Docker image). For distributed setups, build it:

```dockerfile
# sandbox-svc/Dockerfile.opencode (NEW)
FROM node:22-alpine
# Build from source: opencode-serve is NOT a published npm package
# Clone the repository, install deps, build, and serve
RUN git clone https://github.com/opencode-ai/opencode.git /opencode \
  && cd /opencode && npm install && npm run build
EXPOSE 4096
USER node
CMD ["node", "/opencode/dist/serve.js", "--port", "4096"]
```

**Note**: The exact build path depends on OpenCode's published Docker image or build output. If OpenCode publishes a Docker image `opencode/serve:latest`, use `FROM opencode/serve:latest` instead. Verify the published image name before implementing. The API contract is: exposes HTTP on :4096, accepts `POST /api/run`. The actual Dockerfile will need to match the OpenCode repo's build outputs. The key requirement: it exposes HTTP on port 4096 and accepts API requests from the Celery workers.

```yaml
services:
  syntaro-opencode:
    build:
      context: .
      dockerfile: sandbox-svc/Dockerfile.opencode
    restart: unless-stopped
    ports:
      - "4096:4096"
    environment:
      - OPENCODE_API_KEY=${OPENCODE_API_KEY}
      - OPENCODE_MODEL=${OPENCODE_MODEL:-opencode-go/deepseek-v4-flash}
      - OPENCODE_TIMEOUT=${OPENCODE_TIMEOUT:-600000}
    volumes:
      - opencode_data:/home/opencode/.opencode
    mem_limit: 2g
    cpus: 1.0
    networks:
      - syntaro-net
```

In Phase 1, OpenCode runs on the same machine. In Phase 2+, each worker machine MUST have its own dedicated OpenCode instance — sharing one OpenCode across workers creates a single point of failure and bottleneck. The `OPENCODE_URL` env var on each machine points to its local OpenCode instance.

## Resource budget for small PC

Recommended minimum: **8GB RAM**. Works with 4GB with reduced sandbox memory.

| Component | RAM | CPU | Notes |
|---|---|---|---|
| Webhook server (Node.js) | 150MB | 0.2 | |
| Redis | 100MB | 0.1 | |
| RabbitMQ | 200MB | 0.2 | |
| OpenCode serve | 500MB | 0.5 | Containerized |
| Sandbox (1 active, 2GB default) | 2GB | 1.0 | Set to 1g on 4GB machines |
| Squid proxy | 128MB | 0.1 | |
| sandbox-svc (Node.js) | 50MB | 0.05 | Lightweight API |
| Docker daemon | 200MB | 0.1 | |
| OS + system | 256MB | 0.1 | |
| Python Celery worker (×2 split) | 200MB | 0.2 | Two processes |
| **Total (8GB machine)** | **~3.8GB** | **~2.5CPU** | **~4GB headroom** ✅ |
| **Total (4GB machine, sandbox=1g)** | **~2.8GB** | **~2.5CPU** | **~1.2GB headroom** ⚠️ |

## Implementation order (revised estimate: 15-20 hours)

1. **Config defaults** (5 min) — lower memory/cpu, KEEP ubuntu:24.04
2. **Hardened args** (15 min) — pids-limit, ulimit, stop-timeout, remove caps, non-root user
3. **Create sandbox-svc microservice** (8-12 hours) — Express HTTP API wrapping spawnSync Docker ops, pool class, GC class, docker.ts adaptation, package.json, Dockerfile, tsconfig, error handling, health endpoint, integration tests
4. **Celery SandboxServiceClient** (1 hour) — Python HTTP client with retry, timeout, error handling
5. **Celery Beat GC trigger** (30 min) — sandbox_gc_trigger task + celeryconfig.py beat_schedule entry
6. **Egress proxy** (2 hours) — Squid container, config generation, host iptables rules, network test
7. **OpenCode containerization** (2-3 hours) — Dockerfile, compose service, verify OpenCode works in container
8. **Plan B: docker-compose.dev.yml + Makefile** (1 hour) — lightweight compose, make dev-* targets
9. **Update docker-compose files** (1 hour) — add sandbox-svc, egress-proxy, opencode services; adjust networking

Total: **15-20 hours** engineering time (not 7-8 — the sandbox-svc is a real microservice, not a 100-line wrapper).

## Non-goals for this phase

- E2B integration changes (E2B is for hosted SaaS, not self-hosted)
- Kubernetes (too complex for small PCs)
- Firecracker microVM (overkill for self-hosted, 15x complexity)
- gVisor (kernel overhead on small machines)
- FUSE/S3 workspace mounts (IONOS phase 3; temp dirs suffice)
- Centralized rate limiting (noted for Phase 3)

## References

- Research: SWE-agent (per-task Docker), SWE-MiniSandbox (mount ns+chroot), Bubblewrap (50KB, <10ms), nsjail (Windmill production), KintsugiBot (E2B Firecracker)
- Hardened Docker recipe: kssd/dockerfiles commit 63605ac
- Agent resource profiling: AgentCgroup paper (arXiv 2602.09345)
- Warm pool scaling: Polpo sandbox architecture
- Egress proxy pattern: opencode-sandbox (Squid container)
