# IONOS Cloud Deployment — Phase 3

> **Scaling STAS to production on IONOS cloud infrastructure.**

This guide covers deploying STAS on [IONOS Cloud](https://cloud.ionos.com) for Phase 3 scale. It assumes you have an IONOS account and the [IONOS CLI](https://github.com/ionos-cloud/ionosctl) installed.

## Prerequisites

- IONOS account with billing enabled
- IONOS CLI (`ionosctl`) authenticated
- A registered domain for TLS termination
- Docker and Docker Compose installed on each VM

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    IONOS Data Center                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  RabbitMQ VM  │  │  Redis VM    │  │  PostgreSQL  │      │
│  │  (4GB, 2 CPU) │  │  (4GB, 2 CPU)│  │  VM (4,2)   │      │
│  └──────┬────────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                   ┌────────┴────────┐                       │
│                   │  IONOS Network  │                       │
│                   │  (private VLAN) │                       │
│                   └────────┬────────┘                       │
│                            │                                │
│          ┌─────────────────┼─────────────────┐              │
│          │                 │                 │              │
│   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐       │
│   │ Worker VM 1 │  │ Worker VM 2 │  │ Worker VM N │       │
│   │ (8G, 4 CPU) │  │ (8G, 4 CPU) │  │ (8G, 4 CPU) │       │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
│          │                │                │               │
│          └────────────────┼────────────────┘               │
│                           │                                │
│                   ┌───────┴────────┐                       │
│                   │  IONOS S3      │                       │
│                   │  (artifacts)   │                       │
│                   └────────────────┘                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  IONOS ALB (optional, for multi-node webhook)        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Resource Management

### IONOS Cloud Panel

The [IONOS Cloud Panel](https://cloud.ionos.com) provides:

- **VM lifecycle**: Create, start, stop, and delete worker VMs
- **Resource scaling**: Adjust RAM, CPU, and disk on running VMs
- **Snapshot & restore**: Create VM snapshots before upgrades
- **Monitoring**: Per-VM CPU, RAM, disk, and network graphs
- **Firewall rules**: Configure inbound/outbound traffic filters
- **Backup**: Scheduled backups with configurable retention

### IONOS Data Center Designer

The [Data Center Designer](https://dcd.ionos.com) provides:

- **Network topology**: Design VLANs, subnets, and routing
- **Private networks**: Isolate worker traffic from the public internet
- **Load balancers**: Configure IONOS ALB for webhook distribution
- **Firewall policies**: Define security zones for broker, worker, and storage tiers
- **IP management**: Reserve and assign public IPs

## Provisioning VMs

### Using IONOS CLI

```bash
# --- Stateful Services (run once) ---

# RabbitMQ VM
ionosctl vm create \
  --name stas-rabbitmq \
  --ram 4096 \
  --cores 2 \
  --image ubuntu:24.04 \
  --datacenter-id <dc-id> \
  --lan-ids <private-lan-id>

# Redis VM
ionosctl vm create \
  --name stas-redis \
  --ram 4096 \
  --cores 2 \
  --image ubuntu:24.04 \
  --datacenter-id <dc-id> \
  --lan-ids <private-lan-id>

# PostgreSQL VM (or use IONOS managed database)
ionosctl vm create \
  --name stas-postgres \
  --ram 4096 \
  --cores 2 \
  --image ubuntu:24.04 \
  --datacenter-id <dc-id> \
  --lan-ids <private-lan-id>

# --- Worker VMs (scale horizontally) ---

ionosctl vm create \
  --name stas-worker-1 \
  --ram 8192 \
  --cores 4 \
  --image ubuntu:24.04 \
  --datacenter-id <dc-id> \
  --lan-ids <private-lan-id> \
  --user-data @./deploy/ionos/cloud-init.yaml
```

### Using Cloud-Init

Create a `cloud-init.yaml` file for worker VM bootstrapping:

```yaml
# deploy/ionos/cloud-init.yaml
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - git

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - git clone https://github.com/your-org/stas /opt/stas
  - cd /opt/stas
  - cp .env.example .env
  - sed -i 's|CELERY_BROKER_URL=.*|CELERY_BROKER_URL=amqp://user:pass@stas-rabbitmq:5672|' .env
  - sed -i 's|CELERY_RESULT_BACKEND=.*|CELERY_RESULT_BACKEND=redis://stas-redis:6379/0|' .env
  - sed -i 's|OPENCODE_URL=.*|OPENCODE_URL=http://stas-opencode:4096|' .env
  - docker compose -f docker-compose.worker.yml up -d
```

## IONOS S3 for Artifact Storage

IONOS S3 is compatible with the AWS S3 SDK. Use it to persist workspace artifacts.

### Bucket Setup

```bash
# Install IONOS S3 CLI
pip install ionoscloud-s3-cli

# Create bucket
ionosctl s3 bucket create --name stas-workspaces-<env>

# Set lifecycle policy (30-day retention)
ionosctl s3 lifecycle put \
  --bucket stas-workspaces-<env> \
  --rule '{"id": "expire-30d", "status": "Enabled", "expiration": {"days": 30}}'

# Enable versioning (optional, for audit trail)
ionosctl s3 bucket versioning enable --bucket stas-workspaces-<env>
```

### Configuration

Add to `.env`:

```bash
# IONOS S3-compatible object storage
S3_ENDPOINT=https://<your-region>.ionosobjects.com
S3_REGION=de
S3_ACCESS_KEY_ID=<ionos-s3-key>
S3_SECRET_ACCESS_KEY=<ionos-s3-secret>
S3_BUCKET=stas-workspaces-prod

# Optional: artifact retention
S3_ARTIFACT_RETENTION_DAYS=30
```

### Usage

Workspace artifacts are stored under:

```
s3://stas-workspaces-prod/{org}/{repo}/{issue-number}/
  ├── logs/
  ├── test-reports/
  ├── diffs/
  └── metadata.json
```

## Network Topology

### Security Groups

| Tier | Inbound | Outbound | Description |
|---|---|---|---|
| Worker VMs | SSH (admin IP), RabbitMQ (from broker), Redis (from broker) | GitHub API, LLM APIs, S3, package registries, DNS | Task execution nodes |
| RabbitMQ | AMQP (5672) from workers, Management (15672) from admin | All internal | Message broker |
| Redis | Redis (6379) from workers | All internal | Result backend |
| PostgreSQL | PostgreSQL (5432) from workers | All internal | Database |
| ALB | HTTPS (443) from internet | HTTP to webhook VMs | Load balancer |

### Firewall Rules (via Data Center Designer)

```bash
# Allow worker outbound to GitHub API
ionosctl firewall-rule create \
  --datacenter-id <dc-id> \
  --server-id <worker-id> \
  --name allow-github-api \
  --protocol TCP \
  --source-ip 0.0.0.0/0 \
  --target-ip 140.82.112.0/20 \
  --port-range-start 443 \
  --port-range-end 443

# Allow worker outbound to package registries
ionosctl firewall-rule create \
  --name allow-npm \
  --protocol TCP \
  --port-range-start 443 \
  --port-range-end 443
```

## Load Balancing (Optional)

For multi-node webhook deployments, use IONOS Application Load Balancer:

```bash
# Create target group
ionosctl alb target-group create \
  --name stas-webhook-targets \
  --protocol HTTP \
  --port 3000 \
  --health-check-path /health/ready

# Create load balancer
ionosctl alb create \
  --name stas-webhook-alb \
  --listener-protocol HTTPS \
  --listener-port 443 \
  --target-group stas-webhook-targets \
  --certificate-id <ssl-cert-id>

# Add worker VMs as targets
ionosctl alb target add \
  --target-group stas-webhook-targets \
  --ip <webhook-vm-1-ip> \
  --port 3000

ionosctl alb target add \
  --target-group stas-webhook-targets \
  --ip <webhook-vm-2-ip> \
  --port 3000
```

## Monitoring

### IONOS Cloud Panel

- Per-VM CPU, RAM, disk utilization graphs
- Network throughput and packet loss
- VM status and uptime

### Prometheus + Grafana

Each worker exposes metrics on port 9090. Set up a central Prometheus instance on a monitoring VM:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'stas-workers'
    static_configs:
      - targets:
          - 'worker-1:9090'
          - 'worker-2:9090'
          - 'worker-3:9090'
```

### Key Metrics

| Metric | Where | Alert Threshold |
|---|---|---|
| Queue depth | RabbitMQ MGMT UI | > 50 for 5 min |
| Worker CPU | IONOS Panel | > 80% for 10 min |
| Worker memory | IONOS Panel | > 85% for 5 min |
| Task failure rate | Prometheus (worker) | > 10% over 1 hour |
| S3 bucket size | IONOS S3 Panel | > 80% capacity |

## Disaster Recovery

### Backup Strategy

| Component | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | pg_dump via cron | Every 6 hours | 30 days |
| Redis | RDB snapshots | Every hour | 7 days |
| RabbitMQ | Definition export | Daily | 30 days |
| S3 artifacts | S3 versioning | Real-time | 30 days |
| VM configs | `ionosctl vm list` | Weekly | — |

### Recovery Procedure

1. **Replace failed worker**: Launch a new VM with the same cloud-init template
2. **Restore PostgreSQL**: `pg_restore -d stas < latest-backup`
3. **Restore Redis**: Copy RDB snapshot to `/var/lib/redis/dump.rdb`
4. **Restore RabbitMQ**: `rabbitmqadmin import rabbitmq.definitions.json`
5. **Restore ALB**: Re-run ALB setup with existing target group

## Cost Estimation

| Component | Spec | Monthly (est.) |
|---|---|---|
| 3 Worker VMs | 8GB RAM, 4 CPU, 50GB | ~€120 |
| RabbitMQ VM | 4GB RAM, 2 CPU, 20GB | ~€20 |
| Redis VM | 4GB RAM, 2 CPU, 20GB | ~€20 |
| PostgreSQL VM | 4GB RAM, 2 CPU, 50GB | ~€30 |
| IONOS S3 | 100GB storage | ~€5 |
| ALB | 1 listener, 3 targets | ~€15 |
| **Total** | | **~€210/mo** |

## Migration from Phase 2

1. **Set up stateful VMs** (RabbitMQ, Redis, PostgreSQL) in the IONOS Data Center
2. **Update DNS** to point workers at the new broker/backend endpoints
3. **Gradually migrate workers**: start IONOS workers, stop on-prem workers one by one
4. **Configure S3** and update environment variables
5. **Enable ALB** if running multiple webhook nodes
6. **Monitor for 48 hours** before decommissioning on-prem hardware
