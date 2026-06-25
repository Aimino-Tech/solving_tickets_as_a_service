# KEDA Auto-Scaling for Celery Workers

> **Queue-depth-driven Horizontal Pod Autoscaling** — scale from 0 to 20
> replicas based on real-time Celery queue backlog.

## Overview

STAS uses [KEDA](https://keda.sh) (Kubernetes Event-driven Autoscaling) to
dynamically scale Celery worker pods based on RabbitMQ queue depth.  When
a queue builds up a backlog, KEDA increases the replica count.  When queues
drain, it scales back down — all the way to zero during idle periods.

### Architecture

```
                    +--------------------------+
                    |   KEDA Operator           |
                    |   (cluster-wide)          |
                    +------+-------------------+
                           | watches
                    +------v-------------------+
                    |  ScaledObject             |
                    |  (stas-worker)            |
                    +--+--------+-------------+
                       |        |
              +--------v-+   +--v------------+
              | RabbitMQ |   | Prometheus    |
              | Mgmt API |   | (fallback)    |
              +----------+   +---------------+
                       |        |
                       +--+----+
                          | creates / manages
                   +------v----------+
                   |  HPA (managed   |
                   |  by KEDA)       |
                   +------+----------+
                          | scales
                   +------v----------+
                   |  stas-worker    |
                   |  Deployment     |
                   |  (0-20 pods)    |
                   +-----------------+
```

## Quick Start

### Prerequisites

1. **KEDA v2.12+** installed in the cluster:
   ```bash
   helm repo add kedacore https://kedacore.github.io/charts
   helm upgrade --install keda kedacore/keda --namespace keda --create-namespace
   ```

2. **RabbitMQ Management Plugin** enabled on the broker:
   ```bash
   rabbitmq-plugins enable rabbitmq_management
   ```

3. **Kubernetes Secret** with RabbitMQ connection string:
   ```bash
   kubectl create secret generic stas-secrets \
     --from-literal=RABBITMQ_KEDA_CONNECTION="amqp://user:password@stas-rabbitmq:5672/stas"
   ```

### Install the ScaledObject

```bash
kubectl apply -f k8s/keda-scaled-object.yaml

# Verify
kubectl get scaledobject stas-worker
kubectl get hpa                          # KEDA creates this automatically
kubectl describe scaledobject stas-worker
```

### Verify Autoscaling

Publish a test message to the dispatch queue:

```bash
kubectl exec deploy/stas-rabbitmq -- rabbitmqadmin \
  publish exchange=stas routing_key=stas.agents.dispatch \
  payload='{"task": "test"}'
```

Watch KEDA react:

```bash
kubectl get hpa stas-worker --watch
kubectl get pods -l app=stas-worker --watch
```

## ScaledObject Configuration

The full manifest lives at `k8s/keda-scaled-object.yaml`.  Key parameters:

| Parameter | Value | Description |
|---|---|---|
| `minReplicaCount` | `0` | Scale to zero when idle |
| `maxReplicaCount` | `20` | Maximum parallel workers |
| `pollingInterval` | `15s` | How often KEDA checks queue depth |
| `cooldownPeriod` | `120s` | Wait before scaling down |
| `stabilizationWindowSeconds` (up) | `0` | Immediate scale-up |
| `stabilizationWindowSeconds` (down) | `60` | Brief hold before scale-down |

### Per-Queue Thresholds

Each Celery queue has a backlog threshold that triggers a scale-up event:

| Queue | Threshold | Rationale |
|---|---|---|
| `stas.agents.dispatch` | 2 | High-priority — agent execution tasks |
| `stas.agents.sandbox` | 3 | Long-running, resource-heavy |
| `stas.agents.verification` | 3 | Moderate-duration test runs |
| `stas.agents.triage` | 5 | Short-lived classification |
| `stas.agents.pr_creation` | 5 | Batchable, fast |
| `stas.agents.notifications` | 10 | High-volume, cheap |
| `stas.agents.default` | 5 | Catch-all / fallback |

### Scale-Up vs Scale-Down Behaviour

- **Scale-up** is aggressive: 100% additional capacity every 30 seconds,
  zero stabilization window.  A backlog spike doubles the pod count
  within 30 seconds.
- **Scale-down** is conservative: 50% reduction per 60 seconds, with a
  60-second stabilization window.  Brief lulls do not trigger churn.

## Prometheus Metrics Exporter

The Celery worker starts a lightweight HTTP server on port **9091**
(configurable via `KEDA_METRICS_PORT`) that exposes queue depth metrics
for KEDA's Prometheus scaler.

### Endpoints

| Path | Format | Description |
|---|---|---|
| `GET /keda-metrics` | Prometheus text | Queue depth gauges + collector health |
| `GET /health` | JSON | Liveness / readiness probe |

### Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `keda_queue_depth` | Gauge | `queue` | Ready + unacknowledged messages per queue |
| `keda_up` | Gauge | — | 1 if collector is healthy, 0 if last poll failed |
| `keda_last_poll_seconds` | Gauge | — | Unix timestamp of last successful poll |
| `keda_last_poll_error` | Gauge | `error` | 1 if last poll failed (with error message label) |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_MGMT_URL` | `http://guest:guest@localhost:15672/api/queues` | RabbitMQ Management HTTP API URL |
| `KEDA_METRICS_PORT` | `9091` | TCP port for the metrics HTTP server |
| `KEDA_METRICS_INTERVAL` | `15` | Queue depth polling interval (seconds) |
| `KEDA_ENABLED` | `false` | Set to `true` to enable KEDA mode |

## KEDA Detection

The Python worker detects KEDA via the `KEDA_ENABLED` environment variable.
When set to `"true"`, the Celery app:

1. Skips Celery's native `--autoscale` (KEDA manages pod-level scaling).
2. Starts the queue-depth metrics exporter on `:9091/keda-metrics`.

In Kubernetes, the ConfigMap or Deployment manifest should set this:

```yaml
env:
  - name: KEDA_ENABLED
    value: "true"
```

## Prometheus Scaler (Alternative)

If RabbitMQ Management Plugin is unavailable, KEDA can scrape the
worker's metrics endpoint instead.  Uncomment the Prometheus triggers
in `k8s/keda-scaled-object.yaml`:

```yaml
triggers:
  - type: prometheus
    metadata:
      serverAddress: http://stas-worker-metrics:9091
      metricName: keda_queue_depth
      query: keda_queue_depth{queue="stas.agents.dispatch"}
      threshold: "2"
```

The Prometheus scaler requires the Prometheus Operator or
`kube-prometheus-stack` to be installed so that the metrics endpoint
is scraped into a Prometheus server KEDA can query.

## Operational Notes

### Scaling to Zero

When `minReplicaCount: 0` and all queues are empty, KEDA scales the
Deployment to 0 pods.  The first message published to any queue triggers
a scale-up event.  Expect **15-30 seconds** lag between message arrival
and pod readiness (polling interval + HPA reaction + pod startup).

### Cooldown Tuning

| Scenario | Recommended `cooldownPeriod` |
|---|---|
| Bursty traffic (short spikes) | 180-300s |
| Steady traffic (consistent load) | 60-120s |
| Cost-sensitive (scale down fast) | 30-60s |

### Monitoring

```bash
# KEDA operator logs
kubectl logs -n keda deployment/keda-operator --tail=50

# ScaledObject status
kubectl describe scaledobject stas-worker

# HPA status (created by KEDA)
kubectl get hpa stas-worker -o yaml

# Scrape the metrics endpoint directly
kubectl port-forward deploy/stas-worker 9091:9091
curl http://localhost:9091/keda-metrics

# RabbitMQ queue depth
kubectl exec deploy/stas-rabbitmq -- rabbitmqadmin list queues
```

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Pods not scaling up | RabbitMQ unreachable | Check `RABBITMQ_KEDA_CONNECTION` secret |
| Pods not scaling down | Cooldown period too long | Reduce `cooldownPeriod` |
| Metrics endpoint unreachable | Port mismatch | Verify `KEDA_METRICS_PORT` matches ScaledObject |
| KEDA operator errors | Missing TriggerAuthentication | Apply `k8s/keda-scaled-object.yaml` (contains auth) |
| HPA stuck at 0 replicas | `minReplicaCount: 0` + no messages | Send test message to trigger scale-up |

### Related Documents

- [Scaling Architecture](../SCALING.md) — overall scaling strategy
- [Kubernetes Deployments](../../k8s/deployment-worker.yaml) — worker Deployment manifest
- [KEDA Documentation](https://keda.sh/docs/latest/)
