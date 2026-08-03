# SYNTARO on Kubernetes — Deployment Guide

Complete, self-contained manifests for running the full SYNTARO stack on a
Kubernetes cluster (kind, k3s, EKS, GKE, AKS, IONOS Managed K8s...).

## What's in `k8s/`

| File | Deploys | Notes |
|---|---|---|
| `namespace.yaml` | `syntaro` namespace | everything lives here |
| `secret.yaml` | `syntaro-secrets`, `syntaro-tls` | **TEMPLATE — replace placeholders** |
| `configmap.yaml` | `syntaro-config` | non-secret env |
| `postgres.yaml` | PostgreSQL 16 StatefulSet + Service + 20Gi PVC | |
| `redis.yaml` | Redis 7 + PVC (requirepass from Secret) | |
| `rabbitmq.yaml` | RabbitMQ 4 StatefulSet + Service + 10Gi PVC | includes `transient_nonexcl_queues` fix |
| `opencode.yaml` | OpenCode serve Deployment + Service (:4096) | the AI agent backend |
| `mcp.yaml` | MCP SSE server Deployment + Service (:4095) | built from `Dockerfile.smithery` |
| `deployment-webhook.yaml` | webhook Deployment (2 replicas) | the Express API |
| `service-webhook.yaml` | webhook Service | ClusterIP :80 -> 3000 |
| `deployment-worker.yaml` | Celery worker Deployment (2 replicas) | |
| `beat.yaml` | Celery beat Deployment (1 replica) | exactly one |
| `dashboard.yaml` | dashboard Deployment + Service | nginx static |
| `ingress.yaml` | Ingress (TLS via cert-manager) | app.syntaro.io + dashboard.syntaro.io |
| `nginx-deployment.yaml` | standalone nginx + HPA | optional if no Ingress controller |
| `monitoring.yaml` | Prometheus + Grafana + dashboards | |
| `hpa.yaml` | webhook/worker HPA | CPU/memory autoscaling |
| `keda-scaled-object.yaml` | KEDA RabbitMQ queue-depth scaling | optional (needs KEDA) |
| `scaled-object.yaml` | legacy KEDA (superseded) | can be skipped |
| `nginx-config.yaml` | nginx config for the standalone nginx | unused if using Ingress |

## Apply order

```bash
# 1. Prerequisites (cluster-side, one-time)
#    - Ingress controller (nginx-ingress or similar)
#    - cert-manager with ClusterIssuer named "letsencrypt-prod"
#      (change the annotation in ingress.yaml if yours differs)
#    - (optional) KEDA v2.12+ for queue-depth autoscaling

# 2. Namespace + secrets + config
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml      # after filling in real values
kubectl apply -f k8s/configmap.yaml

# 3. Datastores (wait until healthy before app)
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/rabbitmq.yaml
kubectl -n syntaro rollout status statefulset/syntaro-postgres
kubectl -n syntaro rollout status statefulset/syntaro-rabbitmq
kubectl -n syntaro rollout status deployment/syntaro-redis

# 4. Agent backends
kubectl apply -f k8s/opencode.yaml
kubectl apply -f k8s/mcp.yaml

# 5. Application
kubectl apply -f k8s/deployment-webhook.yaml
kubectl apply -f k8s/service-webhook.yaml
kubectl apply -f k8s/deployment-worker.yaml
kubectl apply -f k8s/beat.yaml
kubectl apply -f k8s/dashboard.yaml

# 6. Ingress + TLS
kubectl apply -f k8s/ingress.yaml

# 7. Monitoring + autoscaling (optional)
kubectl apply -f k8s/monitoring.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/keda-scaled-object.yaml   # if KEDA installed
```

## Secret values you MUST set

```bash
kubectl -n syntaro create secret generic syntaro-secrets \
  --from-literal=GITHUB_APP_ID=<id> \
  --from-literal=GITHUB_APP_PRIVATE_KEY="$(cat private-key.pem)" \
  --from-literal=GITHUB_WEBHOOK_SECRET=<secret> \
  --from-literal=JWT_SECRET=<32+ random> \
  --from-literal=ENCRYPTION_SECRET=<32+ random> \
  --from-literal=ANTHROPIC_API_KEY=<key> \
  --from-literal=POSTGRES_PASSWORD=<pw> \
  --from-literal=REDIS_PASSWORD=<pw> \
  --from-literal=RABBITMQ_PASSWORD=<pw> \
  --from-literal=GRAFANA_ADMIN_PASSWORD=<pw>
```

The connection URLs in the template (`DATABASE_URL`, `REDIS_URL`,
`RABBITMQ_URL`) already use the in-cluster hostnames; only the passwords
need to match the per-service `*_PASSWORD` keys.

## Verify

```bash
kubectl -n syntaro get pods          # all Running/Ready
kubectl -n syntaro get svc,ingress
kubectl -n syntaro get certificates  # TLS issued

# Ingress -> webhook
curl -k https://app.syntaro.io/health
# Dashboard
curl -k https://dashboard.syntaro.io/
# Prometheus
kubectl -n syntaro port-forward svc/syntaro-prometheus 9090:9090
# Grafana
kubectl -n syntaro port-forward svc/syntaro-grafana 3000:3000
# RabbitMQ management
kubectl -n syntaro port-forward svc/syntaro-rabbitmq 15672:15672
```

## Notes & gotchas

- **Webhook endpoint**: point the GitHub App's webhook URL at
  `https://app.syntaro.io/webhook` (or whatever `GITHUB_WEBHOOK_PATH` is).
- **Images** are pushed to `ghcr.io/aimino-tech/*`. Build/push before
  applying:
  ```bash
  docker build -t ghcr.io/aimino-tech/solving_tickets_as_a_service:latest .
  docker build -t ghcr.io/aimino-tech/syntaro-worker:latest ./workers
  docker build -t ghcr.io/aimino-tech/syntaro-dashboard:latest ./dashboard
  docker build -f Dockerfile.smithery -t ghcr.io/aimino-tech/syntaro-mcp:latest .
  docker push ghcr.io/aimino-tech/solving_tickets_as_a_service:latest
  docker push ghcr.io/aimino-tech/syntaro-worker:latest
  docker push ghcr.io/aimino-tech/syntaro-dashboard:latest
  docker push ghcr.io/aimino-tech/syntaro-mcp:latest
  ```
- **RabbitMQ 4 + Celery**: the `transient_nonexcl_queues` feature flag is
  enabled in `syntaro-rabbitmq-config` — required or Celery workers crash.
- **OpenCode image**: verify `ghcr.io/sst/opencode` exposes `serve` in your
  target version; adjust `args` if the flag set differs.
- **Persistent volumes**: `ReadWriteOnce` PVCs assume single-node or
  shared-storage-backed volumes. On multi-node clusters use a CSI driver
  that supports RWO.
- **Scaling**: webhook HPA 2–10, worker HPA 2–20; KEDA scales workers
  0–20 by queue depth when installed.
