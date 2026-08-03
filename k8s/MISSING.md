# SYNTARO Kubernetes — What Still Needs To Be Done (Manual Steps)

Everything in this file **cannot be automated from this machine** — each item
requires access to the cluster, the container registry credentials, DNS
control, or the GitHub App settings. The k8s manifests are complete and
validated; this is the remaining human checklist.

## 1. Cluster prerequisites (one-time, on the cluster)

| Requirement | How to install | Why |
|---|---|---|
| Kubernetes 1.28+ | existing cluster (EKS/GKE/AKS/k3s/kind/IONOS) | — |
| nginx Ingress controller | `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.1/deploy/static/provider/cloud/deploy.yaml` | routes external traffic to the Ingress |
| cert-manager + ClusterIssuer | `kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml` | issues the TLS certs; must create a ClusterIssuer named **`letsencrypt-prod`** (edit the annotation in `k8s/ingress.yaml` if yours differs) |
| KEDA v2.12+ *(optional)* | `helm repo add kedacore && helm install keda kedacore/keda` | queue-depth worker autoscaling (`k8s/keda-scaled-object.yaml`) |
| StorageClass supporting RWO | cluster default or CSI driver | the PVCs (`postgres-data` 20Gi, `redis-data` 5Gi, `rabbitmq-data` 10Gi) |

## 2. Secrets — real values (blocking)

`k8s/secret.yaml` is a template. Every value is a placeholder. Create the
Secret with real credentials before applying:

```bash
kubectl -n syntaro create secret generic syntaro-secrets \
  --from-literal=GITHUB_APP_ID=<real id> \
  --from-literal=GITHUB_APP_PRIVATE_KEY="$(cat private-key.pem)" \
  --from-literal=GITHUB_WEBHOOK_SECRET=<real secret> \
  --from-literal=JWT_SECRET=<32+ random> \
  --from-literal=ENCRYPTION_SECRET=<32+ random> \
  --from-literal=ANTHROPIC_API_KEY=<key> \
  --from-literal=POSTGRES_PASSWORD=<pw> \
  --from-literal=REDIS_PASSWORD=<pw> \
  --from-literal=RABBITMQ_PASSWORD=<pw> \
  --from-literal=GRAFANA_ADMIN_PASSWORD=<pw>
```

⚠️ **The passwords in the `*_URL` keys must match the `*_PASSWORD` keys** —
the datastore deployments set their own password from `*_PASSWORD`, and the
app connects via the URL. If they diverge, auth fails silently.

## 3. Container images — build + push (blocking)

The manifests reference 4 images under `ghcr.io/aimino-tech/*`. Only the main
image is built by CI today (`.github/workflows/cd.yml` pushes
`ghcr.io/${{ github.repository }}` = `ghcr.io/Aimino-Tech/solving_tickets_as_a_service`).
The other three have **no CI pipeline** — build and push manually once, then
add workflows or the k8s rollout will `ImagePullBackOff`:

```bash
docker build -t ghcr.io/aimino-tech/solving_tickets_as_a_service:latest .
docker build -t ghcr.io/aimino-tech/syntaro-worker:latest -f workers/Dockerfile .
docker build -t ghcr.io/aimino-tech/syntaro-dashboard:latest ./dashboard
docker build -f Dockerfile.smithery -t ghcr.io/aimino-tech/syntaro-mcp:latest .
docker push ghcr.io/aimino-tech/solving_tickets_as_a_service:latest
docker push ghcr.io/aimino-tech/syntaro-worker:latest
docker push ghcr.io/aimino-tech/syntaro-dashboard:latest
docker push ghcr.io/aimino-tech/syntaro-mcp:latest
```

Notes:
- **Worker context**: the worker Dockerfile references `syntaro_project/`
  (repo root), so build it with `-f workers/Dockerfile .` from the repo root —
  NOT `./workers` as build context (that fails with "file not found").
- **GitHub Actions**: `IMAGE_NAME: ${{ github.repository }}` resolves to
  `Aimino-Tech/solving_tickets_as_a_service` (capital A) — GHCR is
  case-insensitive, so `ghcr.io/aimino-tech/...` in the manifests matches.
- **OpenCode image**: `ghcr.io/sst/opencode:latest` — verify it exposes the
  `serve` command and `:4096` in the pinned version; adjust `args` if not.
  This is the only third-party image.

## 4. DNS

Point these hostnames at the cluster's Ingress load-balancer IP:

```
app.syntaro.io        A  <ingress-nginx LB IP>
dashboard.syntaro.io  A  <ingress-nginx LB IP>
```

(Get the IP with `kubectl -n ingress-nginx get svc ingress-nginx-controller`.)

## 5. GitHub App webhook URL

After the Ingress is live, set the GitHub App's webhook URL to
`https://app.syntaro.io/webhook` (the app's `GITHUB_WEBHOOK_PATH` default is
`/webhook`). Re-deliver a test webhook from GitHub → check the webhook pod
logs confirm signature verification passes.

## 6. External managed services vs in-cluster (decision)

The manifests ship **in-cluster** Postgres/Redis/RabbitMQ (StatefulSets with
PVCs). If you instead want the already-deployed managed services (behind the
Cloudflare tunnel — `db.syntaro.io`, `mq.syntaro.io`, `redis.syntaro.io`):

1. Follow `docs/cloudflare-tunnel-tcp.md` to expose their raw TCP ports.
2. In `k8s/secret.yaml`, point the `*_URL` keys at the tunnel forwarders
   (e.g. `amqp://rmq_admin:...@localhost:5672/`).
3. Do **not** apply `k8s/postgres.yaml`, `k8s/redis.yaml`, `k8s/rabbitmq.yaml`.
4. Confirm the deployed RabbitMQ has the `transient_nonexcl_queues` feature
   enabled (the Celery-compat fix) — the remote broker was deployed before
   that flag; verify or Celery workers crash-loop.

## 7. Fixed during this session (committed with this change)

These were **broken in the repo** and are already fixed in this commit:

| File | What was wrong | Fix |
|---|---|---|
| `k8s/deployment-worker.yaml` | `celery -A celery_app` — module doesn't exist | `-A workers.celery_app` |
| `k8s/beat.yaml` (new) | same wrong module | `-A workers.celery_app` |
| `k8s/deployment-worker.yaml` | probe ran `/app/health.py` (doesn't exist) | `/app/workers/health.py --check` |
| `k8s/deployment-webhook.yaml` | probes hit `/health/live` + `/health/ready` — **routes don't exist in the app** (only `/health`, `/health/verbose`, `/health/queue`, `/health/dependencies`, `/health/sla`) | both probes → `/health` |
| `k8s/configmap.yaml` | used `REDIS_HOST`/`RABBITMQ_HOST`/`POSTGRES_HOST` — app's `config.ts` does not read those; it needs full URLs | URLs moved to Secret; configmap carries the rest |
| `packages/github-client/package.json` | `prepare: npm run build` runs `tsc` during `npm install` (npm 10 runs workspace prepare even with `--ignore-scripts`) → every container build of the main image failed | renamed to `prepublishOnly` (builds only on publish) |
| `dashboard/package-lock.json` | generated under root `.npmrc` `legacy-peer-deps=true`, so `npm ci` (without the flag, as the Dockerfile runs it) failed "Missing lz-string/pretty-format/aria-query" | regenerated without `legacy-peer-deps` so `npm ci` is self-consistent |
| `k8s/deployment.yaml` (legacy `syntaro-bot`) | referenced phantom Secret `syntaro-env`, stale `tamnguyen08` image | now uses `syntaro-secrets` + `syntaro-config`, fixed image |
| all k8s manifests | image refs `ghcr.io/tamnguyen08/*` | → `ghcr.io/aimino-tech/*` |
| all k8s resources | no namespace | → `namespace: syntaro` |

## 8. Left-over repo hygiene (nice-to-have, not blocking)

- `k8s/deployment.yaml` (`syntaro-bot`) duplicates `k8s/deployment-webhook.yaml`
  (`syntaro-webhook`). Both are valid; the webhook one is the primary. Delete
  `deployment.yaml` if you don't want two webhook deployments.
- `k8s/scaled-object.yaml` is the older KEDA manifest superseded by
  `keda-scaled-object.yaml` — apply only one.
- The app's own `docker-compose.prod.yml` still probes `/health/ready`
  (non-existent route) — the compose healthcheck will never be healthy. Fix
  to `/health` if compose remains a supported deployment path.
- `monitoring/prometheus.yml` (compose path) references `syntaro-bot`,
  `syntaro-worker`, `syntaro-redis`, `syntaro-nginx` targets that don't match
  compose service names — only relevant if you run the compose monitoring.
- No CI pipeline builds/pushes the worker, dashboard, or MCP images yet.

## 9. Apply + verify (once the above is done)

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml -f k8s/configmap.yaml
kubectl apply -f k8s/postgres.yaml -f k8s/redis.yaml -f k8s/rabbitmq.yaml
kubectl apply -f k8s/opencode.yaml -f k8s/mcp.yaml
kubectl apply -f k8s/deployment-webhook.yaml -f k8s/service-webhook.yaml
kubectl apply -f k8s/deployment-worker.yaml -f k8s/beat.yaml -f k8s/dashboard.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/monitoring.yaml -f k8s/hpa.yaml
# optional:
kubectl apply -f k8s/keda-scaled-object.yaml

kubectl -n syntaro get pods,svc,ingress
kubectl -n syntaro rollout status deployment/syntaro-webhook
curl -k https://app.syntaro.io/health
```

Full detail: `k8s/KUBERNETES.md`.
