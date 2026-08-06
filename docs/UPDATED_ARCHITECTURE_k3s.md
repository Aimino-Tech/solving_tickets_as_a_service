# UPDATED ARCHITECTURE (k3s)

```
═══════════════════════════════════════════════════════════════════

OUR SIDE (thin server — elixir/ in OpenSymphony repo)
────────────────────────────────────────────────────────────────────

Event Sources                     Ingress                  Buffer
────────────────────────────────────────────────────────────────────

Linear webhook ─┐
GitHub webhook ─┤
GitLab webhook ─┤
Bitbucket ──────┤── POST /api/v1/events/:platform ──→ RabbitMQ
Jira ───────────┤    (Phoenix: HMAC verify → user_id)   (durable per-user queues)
Slack ──────────┤                                          user-{id}.tickets
MCP ────────────┘

k3s CLUSTER (single node or small multi-node)
═══════════════════════════════════════════════════════════════════

KEDA ScaledObjects (one per user, queueLength=1) watch queue depth
      │
      ▼  scale 0↔1

┌─────────────────────────────────────────────────────────────────────┐
│ User Pod (runtimeClassName: gvisor — full per-user instance)         │
│                                                                     │
│  opensymphony-worker (image: opensymphony-worker:latest)            │
│   ├── OpenSymphony escript (RalphLoop + auth + dispatch code)       │
│   ├── oh-my-openagent (+ plugins)                                   │
│   ├── git, toolchains                                               │
│   ├── MCP servers (Linear MCP via opencode-dcp-config ConfigMap)    │
│   └── entrypoint: read queue → load user creds (Secret) →           │
│       process tickets → post results → reset                        │
│   probes: /health (liveness) + /health/ready (readiness) on :4001   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Warm Pod (symphony-warm — ALWAYS at most 1 replica)                 │
│  sole owner of the Slack Socket Mode connection                     │
│  supervised entrypoint (opencode restart loop + trap EXIT)          │
│  nodeSelector: node-role.kubernetes.io/control-plane=true           │
│  KEDA cron trigger scales it 0↔1 (hourly wake window)               │
└─────────────────────────────────────────────────────────────────────┘

Deployment notes (k3s):
  • Ingress: ingressClassName: traefik (k3s default), cert-manager ClusterIssuer letsencrypt-prod
  • NetworkPolicy: allow ingress from kube-system (Traefik's namespace)
  • gVisor RuntimeClass (handler: runsc) + node label gvisor=true on the k3s server
  • Shared scalers (elixir/deploy/k8s/scaledobject-agent-run|sandbox|verify) keep
    minReplicaCount 1 on the shared symphony-worker so per-user pods can scale to 0
    without starving the queue (AIM-4449)
  • Storage: k3s built-in local-path StorageClass for any PVCs
  • Full apply order + verify steps: k8s/k3s-deployment.md (in OpenSymphony repo)
═══════════════════════════════════════════════════════════════════
```
