# STAS Production Deployment Runbook

> Solving Tickets As A Service — Operations Guide
> Last updated: 2026-06-08

## Table of Contents

1. [Service Management](#1-service-management)
2. [Scaling](#2-scaling)
3. [Monitoring](#3-monitoring)
4. [Common Failures](#4-common-failures)
5. [Upgrades](#5-upgrades)
6. [Backup & Restore](#6-backup--restore)
7. [Security Incidents](#7-security-incidents)
8. [Quick Reference](#8-quick-reference)

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

### Webhook Instances

```bash
# Scale horizontally
docker compose -f docker-compose.prod.yml up -d --scale stas-webhook=3 stas-webhook

# Verify distribution
docker compose -f docker-compose.prod.yml ps stas-webhook
```

### Worker Pool

```bash
# Increase concurrency (stateless — safe to scale)
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=8 stas-worker

# Check worker health
docker compose -f docker-compose.prod.yml logs --tail=20 stas-worker
```

### Database Connection Pool

Adjust `PGPOOL_SIZE` in `.env` or `docker-compose.prod.yml`:

```yaml
environment:
  - PGPoolSize=20  # Increase from default 10
```

### Rate Limits

Rate limit configuration is in `src/ratelimit/`. Adjust per-tier limits:

| Tier | Requests/min | Concurrent Jobs |
|------|-------------|-----------------|
| Free | 10 | 1 |
| Pro | 60 | 5 |
| Enterprise | 300 | 20 |

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

### Alerting Rules

| Alert | Condition | Severity | Response |
|-------|-----------|----------|----------|
| Queue Depth Critical | `stas_queue_depth > 100` | Critical | See playbook |
| Worker Down | `stas_worker_count == 0` | Critical | Restart worker pool |
| Agent Success Rate Low | `agent_success_rate < 0.8` | Warning | Investigate agent logs |
| Webhook Failure Rate High | `failure_rate > 0.05` | Warning | Check GitHub App webhook |
| Backup Stale | `last_backup_age > 4h` | Warning | Check backup scripts |
| Rate Limit Exhausted | `rate_limit_remaining == 0` | Warning | Check tier limits |
| SSL Certificate Expiring | `cert_expiry_days < 14` | Warning | Renew certificate |

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
| `ops/DR.md` | Disaster recovery plan |
| `ops/playbook.md` | Alert response playbooks |

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

### Escalation Contacts

| Role | Contact | Response Time |
|------|---------|---------------|
| On-call Engineer | #on-call in Slack | 15 min |
| DevOps Lead | @devops-lead | 30 min |
| Security Team | security@aimino.com | 1 hour |
| Emergency | +1-xxx-xxx-xxxx | 5 min |
