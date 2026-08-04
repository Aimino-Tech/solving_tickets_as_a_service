# SYNTARO Production Go-Live Runbook

**Document**: Production Launch Procedure
**Version**: 1.0
**Status**: Pre-Launch
**Owner**: Platform Engineering

---

## Overview

This runbook covers the step-by-step procedure for taking SYNTARO from a verified pre-launch state to live production. Follow sections sequentially. If any step fails, consult the rollback triggers in §4 before proceeding.

### Architecture Diagram

```
GitHub Webhook → Nginx → SYNTARO API (Express) → RabbitMQ → Celery Workers
                    ↓                            ↓
            Governance Proxy ←────→ OpenSymphony (agent dispatch)
                    ↓
           Loki/Prometheus (logging + metrics)
```

### Key Services

| Service | Container | Port | Health Endpoint |
|---------|-----------|------|-----------------|
| SYNTARO API | `syntaro-webhook` | 3000 | `/health/ready` |
| SYNTARO Worker | `syntaro-worker` | — | Celery ping task |
| Celery Beat | `celery-beat` | — | — |
| Governance Proxy | `governance-proxy` | 4002 | `/guardrail/health` |
| OpenSymphony | `opensymphony` | 4001 | `/health` |
| PostgreSQL | `syntaro-postgres` | 5432 | pg_isready |
| Redis | `syntaro-redis` | 6379 | redis-cli ping |
| RabbitMQ | `syntaro-rabbitmq` | 5672 | rabbitmq-diagnostics |
| Nginx | `syntaro-nginx` | 80/443 | — |
| Loki | `syntaro-loki` | 3100 | `/ready` |
| Promtail | `syntaro-promtail` | — | — |
| Flower | `syntaro-flower` | 5555 | — |
| Egress Proxy | `syntaro-egress-proxy` | 3128 | squidclient |
| SYNTARO Dashboard | `syntaro-dashboard` | 5173 | `/healthz` |

---

## 1. Pre-Flight Checks

Run ALL checks before touching production. Mark each pass/fail.

### 1.1 Code Quality

```bash
# TypeScript compile check
cd /path/to/syntaro
npx tsc --noEmit
# Expected: exit code 0, no errors

# Unit tests
npm test
# Expected: all tests pass (0 failing)

# Quality gates
npm run quality-gates
# Expected: all 6 gates produce output on a real ticket
```

| Check | Command | Expected | Actual |
|-------|---------|----------|--------|
| TypeScript | `npx tsc --noEmit` | Exit 0, no errors | |
| Tests | `npm test` | 0 failing | |
| Quality Gates | `npm run quality-gates` | All 6 pass | |

### 1.2 Infrastructure Build

```bash
# Build the full production stack
docker compose -f docker-compose.prod.yml build
# Expected: all images build without errors
```

### 1.3 Health Endpoint Verification

```bash
# Governance proxy
curl -f http://governance-proxy:4002/guardrail/health
# Expected: {"status":"ok","timestamp":"..."}

# OpenSymphony
curl -f http://opensymphony:4001/health
# Expected: {"status":"healthy"}
```

### 1.4 Webhook End-to-End Test

Manual test procedure:

1. Create a test GitHub issue on a configured repo
2. Confirm SYNTARO webhook receiver logs `accepted: true`
3. Confirm the issue appears in the SYNTARO queue
4. Confirm a Celery worker picks it up
5. Confirm OpenCode agent receives dispatch
6. Confirm a PR is created on the repo
7. Verify the PR message is coherent

### 1.5 DLQ Check

```bash
# Check DLQ depth via RabbitMQ management API
curl -s http://rabbitmq:15672/api/queues/%2F/syntaro-issues-dlq | jq '.messages_ready'
# Expected: 0
```

### 1.6 Rate Limiting

```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://syntaro-webhook:3000/webhook \
    -H "Content-Type: application/json" \
    -d '{"action":"test"}'
  echo ""
done
# Expected: 5th or 6th request returns 429
```

| Check | Method | Expected | Actual |
|-------|--------|----------|--------|
| Rate limiting | 5 rapid requests | 429 on request 5-6 | |
| Kill-switch | Tenant with killed status | 402 Payment Required | |

### 1.7 Kill-Switch

```bash
# Set tenant to killed via governance admin API
curl -X POST http://governance-proxy:4002/admin/tenant/test-org/kill \
  -H "x-admin-key: $ADMIN_KEY"

# Send a webhook for that tenant
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://syntaro-webhook:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-github-event: issues" \
  -d '{"action":"opened","repository":{"full_name":"test-org/test-repo"},"issue":{"title":"Test","body":"test"}}'
# Expected: 402

# Re-enable tenant
curl -X POST http://governance-proxy:4002/admin/tenant/test-org/revive
```

### 1.8 Database Backup Verification

```bash
# Test pg_dump
docker exec syntaro-postgres pg_dump -U syntaro -d syntaro -f /tmp/syntaro-backup-test.sql
# Expected: exit 0

# Test restore
docker exec syntaro-postgres psql -U syntaro -d syntaro_restore_test -f /tmp/syntaro-backup-test.sql
# Expected: tables restored without errors

# Clean up
docker exec syntaro-postgres psql -U syntaro -c "DROP DATABASE IF EXISTS syntaro_restore_test"
docker exec syntaro-postgres rm /tmp/syntaro-backup-test.sql
```

### 1.9 Rollback Procedure Test

```bash
# Verify Docker tag rollback
docker pull ghcr.io/aimino-tech/solving_tickets_as_a_service:v<PREVIOUS_VERSION>
# Verify Railway snapshot (if using Railway)
# railway snapshot list
```

### 1.10 Pre-Flight Checklist

- [ ] `tsc --noEmit` passes
- [ ] `npm test` passes (0 failing)
- [ ] Docker Compose production stack builds
- [ ] All 6 quality gates produce output on a real ticket
- [ ] Governance proxy `/guardrail/health` responds 200
- [ ] OpenSymphony `/health` responds 200
- [ ] Webhook end-to-end: GitHub → SYNTARO → Queue → Agent → PR
- [ ] DLQ is empty
- [ ] Rate limiting confirmed working (5 rapid requests → 429)
- [ ] Kill-switch confirmed working (tenant:killed → 402)
- [ ] Database backup verified (pg_dump works, restore tested)
- [ ] Rollback procedure tested (Docker tag rollback or Railway snapshot)

---

## 2. Launch Sequence

Execute steps in order. Do NOT proceed past a failed step without consulting §4 (Rollback).

### Step 1: Deploy Governance Proxy

```bash
docker compose -f docker-compose.prod.yml up -d governance-proxy
# Wait for health check
sleep 10
curl -f http://governance-proxy:4002/guardrail/health
# If this fails → §4.3 (fail-open governance)
```

### Step 2: Deploy OpenSymphony

```bash
docker compose -f docker-compose.prod.yml up -d opensymphony
sleep 15
curl -f http://opensymphony:4001/health
# If this fails → §4.4 (fall back to direct OpenCode dispatch)
```

### Step 3: Deploy SYNTARO API + Workers

```bash
# Deploy infrastructure services
docker compose -f docker-compose.prod.yml up -d postgres redis rabbitmq

# Wait for infrastructure
sleep 15

# Verify infrastructure health
docker exec syntaro-postgres pg_isready -U syntaro
redis-cli -h syntaro-redis ping
docker exec syntaro-rabbitmq rabbitmq-diagnostics check_port_connectivity

# Deploy application services
docker compose -f docker-compose.prod.yml up -d syntaro-webhook syntaro-worker celery-beat

# Wait for app startup
sleep 20
```

### Step 4: Run DB Migrations

```bash
# Run pending migrations
docker exec syntaro-webhook node dist/scripts/migrate.js
# Expected: "Migrations complete" with no errors

# Verify migration state
docker exec syntaro-postgres psql -U syntaro -d syntaro -c "\dt"
# Expected: all expected tables present
```

### Step 5: Verify Health Endpoints

```bash
echo "=== Health Check ==="
curl -f http://syntaro-webhook:3000/health/ready    || echo "FAIL: SYNTARO API"
curl -f http://syntaro-webhook:3000/health/queue    || echo "FAIL: Queue health"
curl -f http://syntaro-webhook:3000/health/dependencies || echo "FAIL: Dependencies"

echo "=== Worker Health ==="
# Check Celery worker is alive
celery -A workers.celery_app inspect ping --timeout 5 || echo "FAIL: Celery worker"

echo "=== Monitoring ==="
curl -f http://loki:3100/ready                    || echo "FAIL: Loki"
curl -f http://syntaro-webhook:3000/metrics          || echo "FAIL: Metrics"
```

### Step 6: Enable Webhook Receiver

```bash
# Enable the webhook processing pipeline
curl -X POST http://syntaro-webhook:3000/admin/webhook/enable \
  -H "x-admin-key: $ADMIN_KEY"
# Expected: {"status":"enabled"}
```

### Step 7: Monitor DLQ for 30 Minutes

```bash
# Watch DLQ depth every 60 seconds
while true; do
  DEPTH=$(curl -s http://rabbitmq:15672/api/queues/%2F/syntaro-issues-dlq | jq '.messages_ready // 0')
  echo "[$(date)] DLQ depth: $DEPTH"
  if [ "$DEPTH" -gt 20 ]; then
    echo "ALERT: DLQ backlog exceeded threshold"
    # If this triggers → §4.2
  fi
  sleep 60
done
```

### Step 8: Advertise Availability

- [ ] Update status page (syntaro.io)
- [ ] Post to team Slack/Discord channels
- [ ] Enable GitHub Marketplace listing
- [ ] Announce to beta users
- [ ] Update social media

### Launch Sequencing Summary

```
Step 1: Governance Proxy ────────→ success? → continue
                                           ↓ fail → §4.3
Step 2: OpenSymphony ───────────→ success? → continue
                                           ↓ fail → §4.4
Step 3: SYNTARO API + Workers ──────→ success? → continue
                                           ↓ fail → §4.1
Step 4: DB Migrations ───────────→ success? → continue
                                           ↓ fail → rollback migration, §4.1
Step 5: Verify Health ───────────→ success? → continue
                                           ↓ fail → §4.1
Step 6: Enable Webhook ──────────→ success? → continue
                                           ↓ fail → investigate, §4.2
Step 7: Monitor DLQ (30min) ─────→ clean → Step 8
                                           ↓ backlog → §4.2
Step 8: Advertise ───────────────→ DONE
```

---

## 3. Health Check Reference

### Endpoint Quick Reference

| Endpoint | Service | Expected Status Code | Expected Body Contains |
|----------|---------|---------------------|----------------------|
| `/health/ready` | SYNTARO API | 200 | `"ok"` or `"ready"` |
| `/health/queue` | SYNTARO API | 200 | queue depths |
| `/health/dependencies` | SYNTARO API | 200 | dependency status |
| `/metrics` | SYNTARO API | 200 | Prometheus metrics |
| `/guardrail/health` | Governance Proxy | 200 | `"status":"ok"` |
| `/guardrail/ready` | Governance Proxy | 200 | `"ready"` |
| `/guardrail/metrics` | Governance Proxy | 200 | Prometheus metrics |
| `/health` | OpenSymphony | 200 | `"healthy"` |
| `/ready` | Loki | 200 | `"ready"` |

### Log Locations

| Service | Log Source | Command |
|---------|-----------|---------|
| SYNTARO API | Docker | `docker logs syntaro-webhook` |
| SYNTARO Worker | Docker | `docker logs syntaro-worker` |
| Governance | Docker | `docker logs governance-proxy` |
| OpenSymphony | Docker | `docker logs opensymphony` |
| All services | Loki | Grafana @ `http://loki:3100` |
| Celery tasks | Redis | `redis-cli LRANGE celery-task-meta-<task-id> 0 -1` |
| RabbitMQ queues | Management UI | `http://rabbitmq:15672` |

---

## 4. Rollback Triggers

### 4.1 Error Rate >5% in 5 Minutes

**Symptom**: SYNTARO API error rate exceeds 5% over a 5-minute sliding window.

**Action**: Rollback SYNTARO to previous Docker tag.

```bash
# Identify previous stable tag
docker images ghcr.io/aimino-tech/solving_tickets_as_a_service
# Tag the current image for rollback identification
docker tag syntaro-webhook:latest syntaro-webhook:rollback-$(date +%Y%m%d%H%M%S)

# Rollback SYNTARO webhook
docker compose -f docker-compose.prod.yml stop syntaro-webhook
docker compose -f docker-compose.prod.yml rm -f syntaro-webhook
sed -i 's|image: syntaro-webhook:latest|image: ghcr.io/aimino-tech/solving_tickets_as_a_service:v<PREVIOUS>|' docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d syntaro-webhook

# Rollback workers
docker compose -f docker-compose.prod.yml stop syntaro-worker celery-beat
docker compose -f docker-compose.prod.yml rm -f syntaro-worker celery-beat
docker compose -f docker-compose.prod.yml up -d syntaro-worker celery-beat

# Restore original compose file from git
git checkout docker-compose.prod.yml
```

**Time**: ~2 minutes  
**Trigger**: Prometheus alert `SYNTAROErrorRateBurst` or manual observation

### 4.2 DLQ Backlog > 20 in 10 Minutes

**Symptom**: Dead letter queue depth exceeds 20 messages within 10 minutes.

**Action**: Rollback webhook processing and investigate.

```bash
# Disable webhook receiver
curl -X POST http://syntaro-webhook:3000/admin/webhook/disable \
  -H "x-admin-key: $ADMIN_KEY"

# Drain DLQ for investigation
docker exec syntaro-rabbitmq rabbitmqadmin get queue=syntaro-issues-dlq count=100

# Replay specific messages if safe
# docker exec syntaro-rabbitmq rabbitmqadmin publish exchange=syntaro-issues routing_key=syntaro.issues payload="..."

# Investigate root cause before re-enabling
docker logs syntaro-worker --tail 200
docker logs syntaro-webhook --tail 200
```

**Time**: ~5 minutes  
**Trigger**: DLQ depth monitor (Step 7)

### 4.3 Governance Proxy Down > 2 Minutes

**Symptom**: Health check to `/guardrail/health` fails for 2+ consecutive minutes.

**Action**: Fail open (disable governance proxy from the dispatch path).

```bash
# Option A: Bypass governance at SYNTARO config level
export SYNTARO_BYPASS_GOVERNANCE=true
docker compose -f docker-compose.prod.yml restart syntaro-webhook
# SYNTARO will now dispatch directly to OpenSymphony / OpenCode

# Option B: If still failing, bypass governance and restart
docker compose -f docker-compose.prod.yml stop governance-proxy
docker compose -f docker-compose.prod.yml rm -f governance-proxy

# Alert the team
echo "ALERT: governance-proxy removed from path due to 2min downtime" | \
  mail -s "SYNTARO: Governance Proxy Down" ops@aimino.io
```

**Time**: ~1 minute  
**Trigger**: Prometheus alert `GovernanceProxyDown` or manual health check

### 4.4 OpenSymphony Down > 5 Minutes

**Symptom**: OpenSymphony health check fails for 5+ consecutive minutes.

**Action**: Fall back to direct OpenCode dispatch.

```bash
# Configure SYNTARO to dispatch directly to OpenCode
export OPENCODE_URL=http://opencode:4096
export SYNTARO_DISPATCH_MODE=direct
docker compose -f docker-compose.prod.yml restart syntaro-webhook syntaro-worker

# Verify direct dispatch works
curl -f http://opencode:4096/health

# Alert the team
echo "ALERT: OpenSymphony unavailable for 5min — switched to direct OpenCode dispatch" | \
  mail -s "SYNTARO: OpenSymphony Down" ops@aimino.io
```

**Time**: ~3 minutes  
**Trigger**: Prometheus alert `OpenSymphonyDown` or manual health check

### Rollback Decision Matrix

| Symptom | Severity | Action | Time | Who |
|---------|----------|--------|------|-----|
| Error rate >5% in 5min | 🔴 Critical | Rollback SYNTARO to previous Docker tag | 2min | On-call engineer |
| DLQ backlog >20 in 10min | 🟠 High | Disable webhook receiver, drain DLQ, investigate | 5min | On-call engineer |
| Governance proxy down >2min | 🟠 High | Fail open (bypass governance), alert | 1min | On-call engineer |
| OpenSymphony down >5min | 🟡 Medium | Fall back to direct OpenCode dispatch | 3min | On-call engineer |
| PostgreSQL slow queries >10s | 🟠 High | Pause webhook processing, increase pool | 5min | DB admin |
| Redis OOM | 🔴 Critical | Increase Redis memory limit, flush non-critical caches | 2min | On-call engineer |
| RabbitMQ partition | 🔴 Critical | Restart RabbitMQ cluster, check mirrored queues | 10min | Platform engineer |

---

## 5. Post-Launch Verification

Run these checks after the launch sequence completes.

### 5.1 Automated Verification

```bash
echo "=== Post-Launch Checks ==="

# 1. Create a test issue → verify PR created
./scripts/e2e-verify.sh --test-issue
# Expected: issue created, PR created within 5 minutes

# 2. Check DLQ depth = 0
DLQ_DEPTH=$(curl -s http://rabbitmq:15672/api/queues/%2F/syntaro-issues-dlq | jq '.messages_ready // 0')
echo "DLQ depth: $DLQ_DEPTH"
[ "$DLQ_DEPTH" -eq 0 ] && echo "PASS" || echo "FAIL"

# 3. Verify audit logs
curl -s http://loki:3100/loki/api/v1/query_range \
  --data-urlencode 'query={container="syntaro-webhook"} |= "dispatch"' \
  | jq '.data.result | length'
# Expected: > 0 (audit logs are capturing requests)

# 4. Run synthetic webhook test
./scripts/synthetic-webhook-test.sh --source=github
./scripts/synthetic-webhook-test.sh --source=gitlab
# Expected: both succeed
```

### 5.2 Verification Checklist

- [ ] Create a test issue → verify PR created
- [ ] Check DLQ depth = 0 after 1 hour
- [ ] Verify audit logs capturing requests
- [ ] Run synthetic webhook test from second source
- [ ] Confirm Prometheus metrics are reporting
- [ ] Verify Grafana dashboards are populated
- [ ] Check all Celery workers are consuming from correct queues
- [ ] Verify Nginx TLS termination is working
- [ ] Confirm rate limiter is active (5 requests → 429)
- [ ] Run `syntaro-doctor.sh` for comprehensive health summary

### 5.3 Monitoring Dashboard

Open the Grafana dashboards:

| Dashboard | URL | Purpose |
|-----------|-----|---------|
| SYNTARO Overview | `http://grafana:3000/d/syntaro-overview` | Request rates, error rates, latency |
| SYNTARO Workers | `http://grafana:3000/d/syntaro-workers` | Queue depths, task success/fail rates |
| SYNTARO Infrastructure | `http://grafana:3000/d/syntaro-infra` | Redis, Postgres, RabbitMQ health |
| Governance | `http://grafana:3000/d/governance` | Rate limit hits, kill-switch status |
| Loki Logs | `http://grafana:3000/explore` | Search all logs by service |

---

## 6. Emergency Contacts

| Role | Name | Contact |
|------|------|---------|
| On-call Engineer | — | PagerDuty escalation |
| Platform Lead | — | Slack @platform-lead |
| DB Admin | — | Slack @db-admin |
| Security | — | Slack @security |

---

## 7. Probes and Thresholds Reference

### Prometheus Alert Rules

| Alert Name | Condition | Severity | Action |
|------------|-----------|----------|--------|
| `SYNTAROErrorRateBurst` | `rate(http_requests_total{status=~"5.."}[5m]) > 0.05` | critical | §4.1 |
| `SYNTARODLQDepth` | `rabbitmq_queue_messages{queue="syntaro-issues-dlq"} > 20` | warning | §4.2 |
| `GovernanceProxyDown` | `up{job="governance-proxy"} == 0 for > 2m` | critical | §4.3 |
| `OpenSymphonyDown` | `up{job="opensymphony"} == 0 for > 5m` | critical | §4.4 |
| `SYNTAROQueueBacklog` | `rabbitmq_queue_messages_ready{queue="syntaro.issues"} > 100` | warning | Scale workers |
| `PostgresSlowQueries` | `pg_stat_activity_max_query_duration > 10s` | warning | Investigate queries |

### Critical Thresholds

| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| Error rate | <1% | 1-5% | >5% |
| P95 latency | <500ms | 500ms-2s | >2s |
| DLQ depth | 0 | 1-20 | >20 |
| Queue backlog | <50 | 50-200 | >200 |
| Worker idle ratio | >20% | 5-20% | <5% |

---

## 8. Appendices

### A. Environment Variables Required

See `.env.example` and `.env.production.template` for the full list. Key variables:

```bash
# SYNTARO
NODE_ENV=production
REDIS_URL=redis://syntaro-redis:6379
RABBITMQ_URL=amqp://syntaro-app:password@syntaro-rabbitmq:5672/syntaro
DATABASE_URL=postgres://syntaro:password@syntaro-postgres:5432/syntaro
GITHUB_APP_ID=<github-app-id>
GITHUB_PRIVATE_KEY=<base64-encoded-private-key>

# Governance Proxy
GOVERNANCE_API_KEY=<api-key>
LLM_MODEL=gpt-4o

# OpenSymphony
OPENSYMPHONY_SECRET=<shared-secret>

# Monitoring
LOKI_URL=http://syntaro-loki:3100
PROMETHEUS_URL=http://syntaro-prometheus:9090
```

### B. Verified Commands Reference

```bash
# Quick health check
docker compose -f docker-compose.prod.yml ps

# List all service logs (last 50 lines)
docker compose -f docker-compose.prod.yml logs --tail=50

# Restart a single service
docker compose -f docker-compose.prod.yml restart syntaro-webhook

# Scale workers (4 instances)
docker compose -f docker-compose.prod.yml up -d --scale syntaro-worker=4

# Full stack shutdown
docker compose -f docker-compose.prod.yml down

# Full stack restart
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### C. Pre-Launch Checklist (Quick Reference)

```
Pre-Flight:
  ☐ tsc --noEmit passes
  ☐ npm test passes
  ☐ Production stack builds
  ☐ Quality gates pass
  ☐ Governance proxy healthy
  ☐ OpenSymphony healthy
  ☐ E2E webhook test passes
  ☐ DLQ empty
  ☐ Rate limiting works
  ☐ Kill-switch works
  ☐ DB backup verified
  ☐ Rollback tested

Launch Sequence:
  1. Deploy Governance Proxy
  2. Deploy OpenSymphony
  3. Deploy SYNTARO API + Workers
  4. Run DB migrations
  5. Verify health endpoints
  6. Enable webhook receiver
  7. Monitor DLQ for 30min
  8. Advertise availability

Post-Launch:
  ☐ Test issue → PR created
  ☐ DLQ = 0 after 1 hour
  ☐ Audit logs capturing
  ☐ Synthetic webhook passes
```

### D. Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-07-29 | 1.0 | SYNTARO Launch Team | Initial production go-live runbook |
