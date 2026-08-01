# STAS Production Deployment Runbook

> Solving Tickets As A Service — Operations Guide
> Last updated: 2026-07-28

## Table of Contents

1. [Service Management](#1-service-management)
2. [Scaling](#2-scaling)
3. [Monitoring](#3-monitoring)
4. [Common Failures](#4-common-failures)
5. [Upgrades](#5-upgrades)
6. [Backup & Restore](#6-backup--restore)
7. [Security Incidents](#7-security-incidents)
8. [Quick Reference](#8-quick-reference)
9. [Log Aggregation (Loki)](#9-log-aggregation-loki)
10. [Incident Response](#10-incident-response)

---

## 1. Service Management

### Start

```bash
# Production stack (full)
docker compose -f docker-compose.prod.yml up -d

# Individual services
docker compose -f docker-compose.prod.yml up -d stas-webhook
docker compose -f docker-compose.prod.yml up -d stas-worker
docker compose -f docker-compose.prod.yml up -d celery-beat
```

### Stop

```bash
# Graceful shutdown
docker compose -f docker-compose.prod.yml down

# Stop individual service
docker compose -f docker-compose.prod.yml stop stas-webhook
```

### Restart

```bash
# Rolling restart (zero-downtime for webhook with multiple replicas)
docker compose -f docker-compose.prod.yml up -d --no-deps --scale stas-webhook=2 stas-webhook
# Then scale back down
docker compose -f docker-compose.prod.yml up -d --no-deps --scale stas-webhook=1 stas-webhook

# Quick restart
docker compose -f docker-compose.prod.yml restart stas-webhook
```

### Health Check

```bash
# HTTP health endpoint
curl -f http://localhost:3000/health

# Docker container health
docker ps --filter "name=stas" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Detailed health (if available)
curl -s http://localhost:3000/health | jq .
```

### Logs

```bash
# Follow logs
docker compose -f docker-compose.prod.yml logs -f stas-webhook

# Last N lines
docker compose -f docker-compose.prod.yml logs --tail=100 stas-webhook

# Search logs
docker compose -f docker-compose.prod.yml logs stas-webhook | grep -i error

# Worker logs
docker compose -f docker-compose.prod.yml logs -f stas-worker
```

---

## 2. Scaling

### 500-User Reference Architecture

For 500 concurrent users, the recommended production layout is:

| Service | Replicas | vCPU | Memory | Storage |
|---------|----------|------|--------|---------|
| Webhook (Express) | 3 | 0.5 each | 512MB each | — |
| Worker (Celery) | 8 | 1 each | 1GB each | — |
| PostgreSQL | 1 | 4 | 8GB | 100GB SSD |
| Redis | 1 | 2 | 4GB | 50GB SSD |
| RabbitMQ | 1 | 2 | 2GB | 10GB |
| Nginx | 1 | 0.5 | 256MB | — |
| Monitoring | 1 | 1 | 1GB | 50GB |

### Webhook Instances

```bash
# Scale horizontally (minimum 3 for 500 users, up to 6 for peak)
docker compose -f docker-compose.prod.yml up -d --scale stas-webhook=3 stas-webhook

# For peak load (burst)
docker compose -f docker-compose.prod.yml up -d --scale stas-webhook=6 stas-webhook

# Verify distribution
docker compose -f docker-compose.prod.yml ps stas-webhook
```

### Worker Pool

```bash
# Increase concurrency (stateless — safe to scale)
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=8 stas-worker

# For sustained high load
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=12 stas-worker

# Check worker health
docker compose -f docker-compose.prod.yml logs --tail=20 stas-worker
```

### Database Connection Pool

Adjust `PGPOOL_SIZE` in `.env` or `docker-compose.prod.yml`:

```yaml
environment:
  - PGPoolSize=50    # 500 users: min 20, recommended 50
  - PGMAXClientConnections=75  # headroom for monitoring
```

Check connection pool health:

```bash
docker compose exec postgres psql -U stas -c "
  SELECT count(*) AS active_connections
  FROM pg_stat_activity
  WHERE state = 'active';
"
```

### Redis Memory

For 500 users, Redis must be configured with adequate memory:

```yaml
command: >
  redis-server --appendonly yes
  --maxmemory 4gb
  --maxmemory-policy allkeys-lru
  --maxmemory-samples 10
```

### Rate Limits

Rate limit configuration is in `nginx/nginx.conf` (Nginx level) and `src/ratelimit/` (app level). Adjust per-tier limits:

| Tier | Requests/min | Concurrent Jobs | Webhooks/min | Burst |
|------|-------------|-----------------|-------------|-------|
| Free | 10 | 1 | 10 | 5 |
| Pro | 60 | 5 | 60 | 10 |
| Enterprise | 300 | 20 | 300 | 30 |

### Queue Depth Limits

| Limit | Value | Action |
|-------|-------|--------|
| Max pending per repo | 3 | Reject new webhooks for repo |
| Max global queue depth | 200 | Alert at 100, critical at 200 |
| DLQ max before notify | 10 | Auto-notify operator |
| Job TTL | 30 min | Auto-fail long-running jobs |

### Load Testing

```bash
# Run full 500-user load test suite
./scripts/run-load-test.sh http://stas.example.com

# Run individual scenarios
k6 run load-tests/scenarios/full-suite.js
k6 run load-tests/scenarios/database-benchmark.js
k6 run load-tests/scenarios/redis-benchmark.js
```

See `SCALING_500_USERS.md` for the complete scaling guide and cost projections.

---

## 3. Monitoring

### Logs

| Service | Log Location | Retention |
|---------|-------------|-----------|
| Webhook | `docker logs stas-webhook` | Docker default (configurable) |
| Worker | `docker logs stas-worker` | Docker default |
| Nginx | `/var/log/nginx/` | 14 days (logrotate) |
| PostgreSQL | `docker logs stas-postgres` | Docker default |

### Metrics (Prometheus)

Available at `http://localhost:9464/metrics` (or configured port):

| Metric | Type | Description |
|--------|------|-------------|
| `stas_webhooks_received_total` | Counter | Total webhooks received |
| `stas_webhooks_failed_total` | Counter | Failed webhook processing |
| `stas_issues_processed_total` | Counter | Issues processed end-to-end |
| `stas_agent_duration_seconds` | Histogram | Agent fix duration |
| `stas_queue_depth` | Gauge | Current job queue depth |
| `stas_worker_count` | Gauge | Active worker count |
| `stas_rate_limit_remaining` | Gauge | Remaining rate limit per tier |
| `stas_credit_balance` | Gauge | Account credit balances |
| `stas_last_successful_backup_timestamp` | Gauge | Last backup timestamp |

### Grafana

Dashboard available at `monitoring/grafana-dashboard.json`. Import to Grafana:

```bash
# Via API
curl -X POST http://admin:admin@localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -d @monitoring/grafana-dashboard.json
```

### Sentry

Error tracking configured in `src/monitoring/sentry.ts`. Check Sentry dashboard for:

- Unhandled exceptions
- Performance traces
- Crash-free session rate target: > 99.5%

### PagerDuty On-Call Escalation

STAS integrates with PagerDuty via the Events API v2 for on-call alerting. Alerts are routed based on severity:

| Dispatch Condition | PD Severity | Dedup Key |
|---|---|---|
| All `critical` severity alerts | `critical` | `stas-{rule}-{YYYY-MM-DDTHH}` |
| `warning` alerts with `escalated: true` flag | `warning` | `stas-{rule}-{YYYY-MM-DDTHH}` |
| `info` or `warning` (non-escalated) | Not dispatched | — |

**Setup:**
1. Create a PagerDuty service with "Events API v2" integration
2. Set `PD_INTEGRATION_KEY` in `.env`
3. (Optional) Set `PD_ESCALATION_POLICY_ID` for context

**Verify PD is working:**
```bash
# Trigger a test alert via the API (requires admin API key)
curl -X POST http://localhost:3000/admin/test-alert \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"severity":"critical","rule":"test_pd_integration","message":"PD integration test"}'

# Check logs for PD delivery
docker compose -f docker-compose.prod.yml logs stas-webhook | grep -i "pagerduty"
```

**Troubleshooting:**
- `PD_INTEGRATION_KEY not configured` → Set `PD_INTEGRATION_KEY` in `.env`
- `PagerDuty alert delivery failed` → Verify the integration key is valid and the PD service is active
- PD API rate limit: 1 request/second per integration key — alerts are batched via dedup_key

### Alerting Rules

| Alert | Condition | Severity | Channel | Response |
|-------|-----------|----------|---------|----------|
| Queue Depth Critical | `stas_queue_depth > 100` | Critical | Slack + PagerDuty | See playbook |
| Worker Down | `stas_worker_count == 0` | Critical | Slack + PagerDuty | Restart worker pool |
| Agent Success Rate Low | `agent_success_rate < 0.8` | Warning | Slack | Investigate agent logs |
| Webhook Failure Rate High | `failure_rate > 0.05` | Warning | Slack | Check GitHub App webhook |
| Backup Stale | `last_backup_age > 4h` | Warning | Slack | Check backup scripts |
| Rate Limit Exhausted | `rate_limit_remaining == 0` | Warning | Slack | Check tier limits |
| SSL Certificate Expiring | `cert_expiry_days < 14` | Warning | Slack | Renew certificate |


### External Monitoring (Better Uptime)

STAS uses [Better Uptime](https://betteruptime.com) for external uptime monitoring. Configuration: `deploy/monitoring/uptime-config.yml`.

#### Monitored Endpoints

| Endpoint | Interval | Regions | Purpose |
|----------|----------|---------|---------|
| `https://api.syntaro.io/health` | 30s | us-east-1, eu-west-1, ap-southeast-1 | Core liveness |
| `https://api.syntaro.io/health/queue` | 60s | us-east-1, eu-west-1 | Queue health |
| `https://api.syntaro.io/api/pricing` | 5 min | us-east-1, eu-west-1 | Pricing API |
| `https://syntaro.io/` | 5 min | us-east-1, eu-west-1, ap-southeast-1 | Website |
| Synthetic E2E | 5 min | us-east-1 | Pipeline check |

#### Setup

```bash
bash scripts/setup-uptime-monitoring.sh --dry-run
BETTER_UPTIME_API_KEY="key" bash scripts/setup-uptime-monitoring.sh
```

#### Status Page

https://stas.betteruptime.com - 90-day uptime history, public access.

#### Incident Flow

T+0m: Slack + Email | T+5m: SMS on-call | T+15m: PagerDuty escalation

---

## 4. Common Failures

### Redis Connection Lost

**Symptoms**: Queue jobs fail, health check shows Redis unhealthy

**Resolution**:
```bash
# 1. Check Redis status
docker compose -f docker-compose.prod.yml ps redis

# 2. Check logs
docker compose -f docker-compose.prod.yml logs --tail=50 redis

# 3. Restart Redis
docker compose -f docker-compose.prod.yml restart redis

# 4. Verify connection
docker compose exec redis redis-cli PING
# Should return: PONG

# 5. Restart dependent services
docker compose -f docker-compose.prod.yml restart stas-webhook stas-worker celery-beat
```

### RabbitMQ Queue Backed Up

**Symptoms**: Queue depth alert, job processing delayed

**Resolution**:
```bash
# 1. Check queue depth
curl -u guest:guest http://localhost:15672/api/queues | jq '.[].messages_ready'

# 2. Scale workers to drain
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=10 stas-worker

# 3. Monitor drain rate
watch 'curl -s -u guest:guest http://localhost:15672/api/queues | jq ".[] | {name: .name, messages: .messages_ready}"'

# 4. Investigate slow processing
docker compose -f docker-compose.prod.yml logs --tail=50 stas-worker | grep -i "error\|exception\|timeout"

# 5. Scale back down when queue is healthy
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4 stas-worker
```

### PostgreSQL Connection Pool Exhausted

**Symptoms**: 5xx errors on data reads, "too many clients" in logs

**Resolution**:
```bash
# 1. Check active connections
docker compose exec stas-postgres psql -U stas -c "
  SELECT count(*) AS active_connections
  FROM pg_stat_activity
  WHERE state = 'active';
"

# 2. Kill idle connections
docker compose exec stas-postgres psql -U stas -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle'
    AND state_change < NOW() - INTERVAL '5 minutes';
"

# 3. Increase pool size (temporary)
# Set PGPoolSize=50 in docker-compose.prod.yml and restart

# 4. Add connection pooling (PgBouncer) if persistent
```

### OpenCode Agent Stuck

**Symptoms**: Jobs stay "in_progress" for > 30 minutes

**Resolution**:
```bash
# 1. Check agent logs
docker compose -f docker-compose.prod.yml logs stas-worker | grep -i "opencode\|agent"

# 2. Check OpenCode serve health
curl -f http://localhost:4096/health

# 3. Restart OpenCode serve (if self-hosted)
# opencode serve --port 4096 &

# 4. Reset stuck jobs
docker compose exec stas-postgres psql -U stas -c "
  UPDATE run_history
  SET status = 'failed',
      error_message = 'TIMEOUT: Agent stuck for > 30 minutes'
  WHERE status = 'in_progress'
    AND started_at < NOW() - INTERVAL '30 minutes';
"

# 5. Re-queue failed jobs if appropriate
```

### GitHub API Rate Limited

**Symptoms**: "403 rate limit exceeded" in logs

**Resolution**:
```bash
# 1. Check current rate limit status
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.resources.core'

# 2. If limited, wait for reset (shown in API response)
# Reset time is in Unix timestamp

# 3. Install the app on more repos to distribute load
# Or upgrade GitHub App plan

# 4. For urgent fixes, use a PAT as fallback
# GITHUB_TOKEN=<personal-access-token>
```

### Stripe Webhook Failed

**Symptoms**: Payment processing failures, credit purchases stuck

**Resolution**:
```bash
# 1. Check Stripe dashboard for failed webhooks
# https://dashboard.stripe.com/webhooks

# 2. Replay failed webhook events from Stripe dashboard

# 3. Check local webhook signature verification
docker compose -f docker-compose.prod.yml logs --tail=20 stas-webhook | grep -i "stripe\|webhook"

# 4. Verify STAS_ENDPOINT_SECRET is correct in .env
grep STRIPE_ENDPOINT_SECRET .env

# 5. Restart webhook if needed
docker compose -f docker-compose.prod.yml restart stas-webhook
```

### Nginx 502 Bad Gateway

**Symptoms**: Users see 502 errors, health check fails

**Resolution**:
```bash
# 1. Check if webhook is running
docker compose -f docker-compose.prod.yml ps stas-webhook

# 2. Check nginx configuration
docker compose -f docker-compose.prod.yml exec nginx nginx -t

# 3. Check nginx logs
docker compose -f docker-compose.prod.yml logs --tail=50 nginx

# 4. Restart nginx
docker compose -f docker-compose.prod.yml restart nginx

# 5. Verify upstream is reachable
docker compose exec nginx curl -f http://stas-webhook:3000/health
```

---

## 5. Upgrades

### Zero-Downtime Deployment

**Prerequisites**: Multiple webhook replicas, database migration backward-compatible

```bash
# 1. Pull latest image
docker compose -f docker-compose.prod.yml pull stas-webhook

# 2. Scale up new version alongside old
docker compose -f docker-compose.prod.yml up -d --no-deps \
  --scale stas-webhook=3 stas-webhook

# 3. Wait for old containers to drain
sleep 10

# 4. Remove old containers (if using blue-green)
# Or simply let replacement happen

# 5. Run database migrations (if applicable)
docker compose -f docker-compose.prod.yml run --rm stas-webhook \
  npx tsx src/db/migrate.ts

# 6. Roll out workers
docker compose -f docker-compose.prod.yml up -d --no-deps stas-worker

# 7. Verify
curl -f http://localhost:3000/health
```

### Database Migration Steps

1. **Expand**: Add new columns/tables (backward-compatible)
2. **Migrate**: Run data migration (online, non-blocking)
3. **Contract**: Remove old columns (after verifying)

```bash
# Dry-run migration
docker compose -f docker-compose.prod.yml run --rm stas-webhook \
  npx tsx src/db/migrate.ts --dry-run

# Run migration
docker compose -f docker-compose.prod.yml run --rm stas-webhook \
  npx tsx src/db/migrate.ts

# Verify migration
docker compose exec stas-postgres psql -U stas -c "
  SELECT version, name, applied_at
  FROM migrations
  ORDER BY version;
"
```

### Rollback

```bash
# Rollback last migration
docker compose -f docker-compose.prod.yml run --rm stas-webhook \
  npx tsx src/db/migrate.ts --rollback

# Rollback to specific version
docker compose -f docker-compose.prod.yml run --rm stas-webhook \
  npx tsx src/db/migrate.ts --rollback-to 3
```

### Image Update

```bash
# Build new image
docker build -t stas-bot:latest .

# Tag and push
docker tag stas-bot:latest ghcr.io/aimino-tech/stas-bot:$(git rev-parse --short HEAD)
docker push ghcr.io/aimino-tech/stas-bot:$(git rev-parse --short HEAD)

# Deploy
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## 6. Backup & Restore

### Backup (Automated)

Backups run on schedule via systemd timers or Celery Beat:

| Frequency | Script | Retention |
|-----------|--------|-----------|
| Hourly | `scripts/backup-postgres.sh --hourly` | 7 days |
| Hourly | `scripts/backup-redis.sh --hourly` | 7 days |
| Hourly | `scripts/backup-rabbitmq.sh --hourly` | 7 days |
| Daily | `scripts/backup-postgres.sh` | 30 days |
| Daily | `scripts/backup-redis.sh` | 30 days |
| Daily | `scripts/backup-rabbitmq.sh` | 30 days |

### Manual Backup

```bash
# PostgreSQL
./scripts/backup-postgres.sh

# Redis
./scripts/backup-redis.sh

# RabbitMQ definitions
./scripts/backup-rabbitmq.sh
```

### Restore

See `ops/DR.md` for detailed restore procedures.

Quick restore:

```bash
# Find latest backup
LATEST_PG=$(ls -t /var/backups/postgres/daily/ | head -1)

# Restore PostgreSQL
./scripts/restore-postgres.sh /var/backups/postgres/daily/$LATEST_PG

# Restore Redis
./scripts/restore-redis.sh

# Restore RabbitMQ
./scripts/restore-rabbitmq.sh
```

### Backup Verification

```bash
# Check backup age
./scripts/backup-postgres.sh --check

# Verify backup integrity
gpg --decrypt backup.sql.gz.gpg | gunzip | pg_restore --list | head -20
```

---

## 7. Security Incidents

### Credential Rotation

```bash
# 1. Generate new secrets
openssl rand -hex 32  # New webhook secret
openssl rand -hex 32  # New API key

# 2. Update .env
# Update all environment files

# 3. Restart services
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 4. Verify services start with new credentials
curl -f http://localhost:3000/health
```

### Unauthorized Access Response

1. **Identify**: Check auth logs, webhook logs, and Sentry for suspicious activity
2. **Contain**: Rotate credentials, revoke compromised tokens
3. **Eradicate**: Remove unauthorized access points
4. **Recover**: Restore from clean backup if data tampered
5. **Document**: Record incident in `ops/security-incidents/`

```bash
# Check auth logs
docker compose -f docker-compose.prod.yml logs stas-webhook | grep -i "unauthorized\|401\|403"

# Check audit log
docker compose exec stas-postgres psql -U stas -c "
  SELECT * FROM audit_logs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC;
"

# Revoke all sessions (if implemented)
docker compose exec stas-postgres psql -U stas -c "
  DELETE FROM sessions WHERE expires_at < NOW();
"
```

### Vulnerability Patching

```bash
# Scan for vulnerabilities
docker run --rm aquasec/trivy image stas-bot:latest

# Update dependencies
npm audit
npm update

# Rebuild and redeploy
docker build -t stas-bot:latest .
docker compose -f docker-compose.prod.yml up -d
```

### SSL/TLS Certificate Renewal

```bash
# Using certbot (Docker)
docker compose -f docker-compose.prod.yml run --rm certbot renew

# Check expiry
openssl s_client -connect your-domain.com:443 -servername your-domain.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates

# Manual renewal
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot -d your-domain.com
```

---

## 8. Quick Reference

### Service Ports

| Service | Port | Protocol |
|---------|------|----------|
| Webhook API | 3000 | HTTP |
| Nginx | 80/443 | HTTP/HTTPS |
| Redis | 6379 | TCP |
| PostgreSQL | 5432 | TCP |
| RabbitMQ AMQP | 5672 | TCP |
| RabbitMQ Management | 15672 | HTTP |
| Flower (Celery) | 5555 | HTTP |
| Prometheus Metrics | 9464 | HTTP |
| Loki | 3100 | HTTP |

### Key Files

| File | Purpose |
|------|---------|
| `.env` | Environment configuration |
| `docker-compose.prod.yml` | Production stack definition |
| `Dockerfile` | Webhook service image |
| `workers/Dockerfile` | Worker image |
| `nginx/nginx.conf` | Reverse proxy configuration |
| `src/db/migrations/` | Database migrations |
| `monitoring/grafana-dashboard.json` | Grafana dashboard |
| `deploy/monitoring/loki-config.yml` | Loki server configuration |
| `deploy/monitoring/promtail-config.yml` | Promtail log shipper configuration |
| `deploy/monitoring/loki-alerts.yml` | Log-based alert rules |
| `ops/DR.md` | Disaster recovery plan |
| `ops/playbook.md` | Alert response playbooks |
| `ops/incident-response-checklist.md` | On-call incident response checklist |
| `ops/post-mortem-template.md` | Blameless post-mortem template |
| `ops/status-page-template.md` | Status page communication templates |
| `ops/scripts/restore-drill.sh` | Quarterly restore drill automation |

### Useful Commands

```bash
# Real-time log tail (all services)
docker compose -f docker-compose.prod.yml logs -f

# Resource usage
docker stats stas-webhook stas-worker

# Database interactive shell
docker compose exec stas-postgres psql -U stas

# Redis interactive shell
docker compose exec redis redis-cli

# RabbitMQ management
# Open http://localhost:15672 (guest/guest)

# List running containers
docker compose -f docker-compose.prod.yml ps

# Export current configuration
docker compose -f docker-compose.prod.yml config
```

---

## 9. Log Aggregation (Loki)

STAS uses **Grafana Loki** for centralized log aggregation with **Promtail** as the log shipper. All Docker container logs from the `stas` Compose project are automatically shipped to Loki and retained for **7 days**.

### Architecture

```
Container Logs (json-file driver)
       |
       v
  [Promtail] --docker socket--> Docker API (label discovery)
       |
       |  HTTP POST /loki/api/v1/push
       v
  [Loki] --> TSDB index (filesystem)
       |
       |  LogQL queries
       v
  [Grafana] Data Source: http://loki:3100
```

### Querying Logs

Loki exposes a REST API on port **3100**. Query via Grafana Log Explorer or directly:

```bash
# All logs from the webhook service (last 30 min)
curl -s 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={compose_service="stas-webhook"}' \
  --data-urlencode 'start='$(date -d '30 min ago' +%s)'000' \
  --data-urlencode 'end='$(date +%s)'000' \
  --data-urlencode 'limit=100' | jq .

# Error logs from all services (last 1 hour)
curl -s 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={compose_project="stas"} |= "error"' \
  --data-urlencode 'start='$(date -d '1 hour ago' +%s)'000' \
  --data-urlencode 'end='$(date +%s)'000' \
  --data-urlencode 'limit=100' | jq .

# Count 5xx errors per minute (metric query)
curl -s 'http://localhost:3100/loki/api/v1/query' \
  --data-urlencode 'query=sum(rate({compose_service="stas-webhook"} |~ "5[0-9][0-9]" [1m]))' \
  --data-urlencode 'time='$(date +%s)'000' | jq .
```

### Available Labels

Every log entry is automatically tagged with:

| Label | Source | Example |
|-------|--------|---------|
| `container_name` | Docker container name | `stas-webhook` |
| `compose_service` | Docker Compose service name | `stas-worker` |
| `compose_project` | Docker Compose project | `stas` |
| `image_name` | Container image | `stas-webhook:latest` |
| `log_stream` | stdout / stderr | `stdout` |

### Log-Based Alerts

Loki's ruler evaluates alert rules defined in `deploy/monitoring/loki-alerts.yml`:

| Alert | Condition | Severity |
|-------|-----------|----------|
| **HighWebhookErrorRate** | 5+ 5xx responses in 5 min | Critical |
| **WorkerTaskFailures** | 3+ ERROR/CRITICAL in 10 min | Warning |
| **ServiceHealthCheckFailure** | 5+ health-check failures in 5 min | Critical |

Alerts fire through Loki's ruler. For production, configure a proper alertmanager or route through the existing PagerDuty integration.

### Service Management

```bash
# Start Loki + Promtail
docker compose -f docker-compose.prod.yml up -d loki promtail

# View Loki logs
docker compose -f docker-compose.prod.yml logs -f loki

# View Promtail logs
docker compose -f docker-compose.prod.yml logs -f promtail

# Check Loki readiness
curl -f http://localhost:3100/ready

# Check storage usage
docker exec stas-loki du -sh /loki/chunks
```

### Configuration Files

| File | Purpose |
|------|---------|
| `deploy/monitoring/loki-config.yml` | Loki server config (7d retention, TSDB index) |
| `deploy/monitoring/promtail-config.yml` | Promtail Docker log scraping config |
| `deploy/monitoring/loki-alerts.yml` | Log-based alert rules (3 rules) |

### Grafana Integration

To add Loki as a Grafana data source:
1. Open Grafana > **Connections** > **Data Sources**
2. Click **Add data source** > select **Loki**
3. Set URL to `http://loki:3100`
4. Click **Save & Test**

---

---

## 10. Incident Response

### 10.1 Incident Severity Levels

STAS incidents are classified by severity. Severity determines response time, notification channels, and escalation path.

#### SEV-1 — Service Down / Data Loss

| Property | Value |
|---|---|
| **Definition** | Complete service outage or data loss. No issues can be processed. Or confirmed data corruption / loss. |
| **Response Time** | 5 minutes (acknowledge), 15 minutes (first update) |
| **Notification** | PagerDuty (critical) + Slack `#stas-incidents` + Slack `#stas-on-call` + status page |
| **Examples** | Webhook not accepting requests; Worker pool completely down; Database corrupted; RabbitMQ queue lost; Credit balance errors |
| **Escalation** | Immediate — on-call engineer, auto-escalate at T+10 to DevOps Lead if no acknowledgement |
| **Post-mortem** | Required within 3 business days |

#### SEV-2 — Major Feature Broken

| Property | Value |
|---|---|
| **Definition** | A major feature is unavailable or significantly impaired. Core functionality is degraded. |
| **Response Time** | 15 minutes (acknowledge), 30 minutes (first update) |
| **Notification** | PagerDuty (warning) + Slack `#stas-incidents` + status page |
| **Examples** | Agent success rate < 80%; GitHub API rate limited; Webhook delivery failing for a subset of repos; Stripe payment processing broken; OpenCode serve unhealthy |
| **Escalation** | DevOps Lead at T+30 if unresolved |
| **Post-mortem** | Required within 5 business days |

#### SEV-3 — Minor Feature Degraded

| Property | Value |
|---|---|
| **Definition** | A non-critical feature is degraded. Core functionality is working. Workarounds exist. |
| **Response Time** | 1 hour (acknowledge) |
| **Notification** | Slack `#stas-incidents` only (no PagerDuty unless escalated) |
| **Examples** | Dashboard latency; Rate limit near exhaustion; Backup stale; Non-critical API endpoint slow; Nginx latency |
| **Escalation** | DevOps Lead at T+2h if unresolved |
| **Post-mortem** | Optional — brief summary in incident log |

#### SEV-4 — Cosmetic / Non-Urgent

| Property | Value |
|---|---|
| **Definition** | Cosmetic issue, minor bug, or feature request. No user-facing impact on functionality. |
| **Response Time** | Next business day |
| **Notification** | GitHub issue or Linear ticket only |
| **Examples** | Typo in UI; Log message formatting; Minor metric discrepancy; Stale cache display; Deprecation warning |
| **Escalation** | N/A — triaged during regular sprint planning |
| **Post-mortem** | Not required |

### 10.2 Incident Response Flow

Every incident follows this formal five-stage flow:

```
Detection → Triage → Mitigation → Resolution → Post-Mortem
```

#### Stage 1: Detection

| Trigger | Source | Action |
|---|---|---|
| Prometheus alert | Alertmanager → PagerDuty / Slack | Acknowledge within SLA |
| Better Uptime alert | SMS / Email / Slack | Confirm alert is valid |
| Customer report | Support email / Slack / Statuspage | Open PagerDuty incident |
| Internal discovery | Engineer monitoring | Open PagerDuty incident |
| Automated canary | CI/CD pipeline | Auto-file incident |

**Output**: Acknowledged incident with severity assignment.

#### Stage 2: Triage

1. **Confirm** the alert is real (not a false positive)
2. **Classify** severity using §10.1 definitions
3. **Assess** blast radius (single user? all users? data at risk?)
4. **Check** runbook and playbook for guidance
5. **Communicate** initial status to `#stas-incidents` and status page
6. **Decide** on mitigation approach (workaround vs full fix)

**SLA**: SEV-1: 5 min, SEV-2: 15 min, SEV-3: 1 hour

**Output**: Severity classification + initial communication + mitigation plan.

#### Stage 3: Mitigation

1. **Apply** immediate workaround (scale workers, restart service, rollback deploy)
2. **Verify** mitigation is effective (health check passes, error rate drops)
3. **Monitor** for stability (at least 5 minutes of clean metrics)
4. **Update** status page to "Monitoring"
5. **Document** what was done for post-mortem

**Goal**: Restore service as quickly as possible, even with a temporary fix.

**Output**: Service restored (possibly with temporary fix).

#### Stage 4: Resolution

1. **Confirm** all health checks pass
2. **Verify** no residual errors in logs
3. **Test** end-to-end flow (process a test issue)
4. **Update** status page to "Resolved"
5. **Post** final summary to `#stas-incidents`
6. **Close** PagerDuty incident with resolution notes

**Output**: Incident closed, service confirmed healthy.

#### Stage 5: Post-Mortem

1. **Schedule** post-mortem review (within SLA per severity)
2. **Draft** post-mortem using `ops/post-mortem-template.md`
3. **Identify** root cause (5 Whys)
4. **Assign** action items with owners and deadlines
5. **Update** playbook if new failure pattern discovered
6. **File** follow-up tickets for each action item
7. **Present** findings to affected teams

**Output**: Published post-mortem with tracked action items.

### 10.3 Escalation Contacts

| Role | Contact | Response SLA | SEV-1 | SEV-2 | SEV-3 | Available |
|---|---|---|---|---|---|---|
| **On-call Engineer** | `#stas-on-call` Slack, PagerDuty | 5 min / 15 min / 1h | ✓ Primary | ✓ Primary | ✓ Primary | 24/7 |
| **DevOps Lead** | @devops-lead Slack, +1-555-0102 | 15 min / 30 min | ✓ Escalation | ✓ Escalation | ✓ Escalation | 24/7 |
| **Engineering Manager** | @eng-mgr Slack, +1-555-0103 | 30 min / 1h | ✓ Escalation | ✓ Escalation | — | Business hours |
| **Security Team** | security@aimino.com, `#security` Slack | 1 hour | ✓ Security | ✓ Security | — | 24/7 |
| **CTO** | @cto Slack, +1-555-0104 | Upon escalation | ✓ Escalation | — | — | Business hours |
| **Emergency NOC** | +1-555-0199 | 5 min | ✓ Infra | ✓ Infra | — | 24/7 |

### 10.4 Monitoring Dashboards

#### Grafana

| Dashboard | URL | Purpose |
|---|---|---|
| **STAS Overview** | `http://localhost:3000/d/stas-overview` | Primary — all services, queue depth, error rates, fix rate |
| **STAS Workers** | `http://localhost:3000/d/stas-workers` | Worker pool health, job duration, success rate |
| **STAS Database** | `http://localhost:3000/d/stas-database` | Connection pool, query performance, replication lag |
| **STAS Queue** | `http://localhost:3000/d/stas-queue` | Queue depth by priority, DLQ, processing rate |
| **STAS Costs** | `http://localhost:3000/d/stas-costs` | Inference cost per model, daily spend, cost/fix ratio |

> **Note**: Replace `localhost:3000` with the actual Grafana URL in production.
> Default credentials: `admin` / `admin` (change immediately on first login).

#### Prometheus

- **Metrics endpoint**: `http://localhost:9464/metrics`
- **Alertmanager UI**: `http://localhost:9093`
- **Expression browser**: `http://localhost:9090/graph`

#### Logging

- **Loki**: `http://localhost:3100` (query via Grafana Log Explorer)
- **Promtail**: Ships Docker logs automatically (config: `deploy/monitoring/promtail-config.yml`)

#### External Monitoring

- **Better Uptime Status Page**: `https://stas.betteruptime.com`
- **Better Uptime Dashboard**: `https://betteruptime.com/teams/aimino`
- **Sentry Error Tracking**: `https://sentry.io/organizations/aimino/issues/`

#### Quick Metric Queries

```bash
# Current queue depth
curl -s http://localhost:9464/metrics | grep "^stas_queue_depth"

# Worker count
curl -s http://localhost:9464/metrics | grep "^stas_worker_count"

# Recent webhook failure rate (last 5 minutes)
curl -s 'http://localhost:9090/api/v1/query'   --data-urlencode 'query=rate(stas_webhooks_failed_total[5m])' | jq '.data.result'

# Agent success rate (last hour)
curl -s 'http://localhost:9090/api/v1/query'   --data-urlencode 'query=sum(rate(stas_issues_processed_total{status="success"}[1h])) / sum(rate(stas_issues_processed_total[1h]))' | jq '.data.result'
```

### 10.5 Incident Management Tools

| Tool | Purpose | URL / Config |
|---|---|---|
| **PagerDuty** | On-call alerting, scheduling, escalation | Service: "STAS Production", Integration: Events API v2 |
| **Slack** | Real-time incident communication | Channels: `#stas-incidents`, `#stas-on-call` |
| **Better Uptime** | External monitoring, status page | `https://stas.betteruptime.com` |
| **Grafana** | Dashboards, alerting, log exploration | Local: `http://localhost:3000` |
| **Prometheus** | Metrics storage, alert rules | `deploy/monitoring/prometheus-rules.yml` |
| **Sentry** | Error tracking, performance monitoring | `src/monitoring/sentry.ts` |
| **PagerDuty** | On-call schedule, incident tracking | `PD_INTEGRATION_KEY` in `.env` |

### 10.6 Incident Directory

All post-mortems and incident records are stored in `ops/security-incidents/`:

```
ops/security-incidents/
├── INC-0001-2026-06-08-db-pool-exhaustion.md
├── INC-0002-2026-07-04-github-rate-limit.md
└── ...
```

---

*For on-call procedures, see [ops/incident-response-checklist.md](incident-response-checklist.md).*
*For alert-specific playbooks, see [ops/playbook.md](playbook.md).*
*For disaster recovery, see [ops/DR.md](DR.md).*
