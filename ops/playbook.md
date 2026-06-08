# STAS Alert Response Playbooks

> Solving Tickets As A Service — Incident Response
> Last updated: 2026-06-08

## Table of Contents

1. [Queue Depth Critical](#1-queue-depth-critical)
2. [Agent Success Rate Low](#2-agent-success-rate-low)
3. [Webhook Delivery Failed](#3-webhook-delivery-failed)
4. [Worker Pool Empty](#4-worker-pool-empty)
5. [Rate Limit Exhausted](#5-rate-limit-exhausted)
6. [Backup Stale](#6-backup-stale)
7. [Database Connection Pool Exhausted](#7-database-connection-pool-exhausted)

---

## 1. Queue Depth Critical

### Alert Condition

`stas_queue_depth > 100` for > 5 minutes

### Severity

**Critical** — P1, respond within 5 minutes

### Triage (2 min)

```bash
# Check current queue depth
curl -u guest:guest http://localhost:15672/api/queues \
  | jq '.[] | {name: .name, messages: .messages_ready, consumers: .consumers}'
```

| Depth | Action |
|-------|--------|
| 100-500 | Scale workers (see below) |
| 500-1000 | Scale workers + investigate slow consumers |
| > 1000 | Full incident — page on-call |

### Remediation

#### Step 1: Scale Workers (1 min)

```bash
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=8 stas-worker
```

#### Step 2: Identify Bottleneck (3 min)

```bash
# Check if workers are processing or stuck
docker compose -f docker-compose.prod.yml logs --tail=30 stas-worker

# Check for error patterns
docker compose -f docker-compose.prod.yml logs stas-worker \
  | grep -E "error|Error|ERROR|exception|Exception" \
  | tail -20

# Check recent job failures
docker compose exec stas-postgres psql -U stas -c "
  SELECT status, count(*) as count,
         round(avg(extract(epoch from (completed_at - started_at)))::numeric, 1) as avg_duration_s
  FROM run_history
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY status;
"
```

#### Step 3: Fix Issues (5+ min)

- **OpenCode agent slow**: Check OpenCode serve health and model availability
- **Worker crashing**: Check worker logs for OOM or unhandled errors
- **Database slow**: Check `pg_stat_activity` for long-running queries
- **Rate limited**: Check GitHub API rate limit

#### Step 4: Monitor Drain

```bash
watch -n 5 'curl -s -u guest:guest http://localhost:15672/api/queues | jq ".[] | {name: .name, depth: .messages_ready}"'
```

#### Step 5: Scale Back Down

```bash
# When queue is below 20
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4 stas-worker
```

### Prevention

- Set up worker auto-scaling based on queue depth
- Implement job timeouts to prevent stuck jobs from blocking workers
- Add worker health checks with auto-restart

---

## 2. Agent Success Rate Low

### Alert Condition

`agent_success_rate < 0.80` in last 100 runs

### Severity

**Warning** — P2, respond within 30 minutes

### Triage (2 min)

```bash
# Check recent agent runs
docker compose exec stas-postgres psql -U stas -c "
  SELECT status, count(*) as count
  FROM run_history
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY status;
"

# Check failed runs
docker compose exec stas-postgres psql -U stas -c "
  SELECT issue_title, error_message, created_at
  FROM run_history
  WHERE status = 'failed'
    AND created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 10;
"
```

### Common Failure Patterns

| Pattern | Root Cause | Fix |
|---------|-----------|-----|
| `OpenCode returned non-zero exit code` | Agent script failure | Check OpenCode serve |
| `Sandbox timeout` | E2B execution timeout | Increase sandbox timeout |
| `Test suite failed` | Fix broke existing tests | Review agent's changes |
| `Git push rejected` | Branch conflicts | Check for concurrent runs |
| `Model unavailable` | API key issue or model down | Check model status |

### Remediation

#### Step 1: Check OpenCode (1 min)

```bash
curl -f http://localhost:4096/health
```

#### Step 2: Check API Keys (1 min)

```bash
grep -E "OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENCODE_MODEL" .env
```

#### Step 3: Check E2B Sandbox (1 min)

```bash
grep E2B_API_KEY .env
```

#### Step 4: Review Recent Changes (2 min)

```bash
# Check if recent deploy caused regression
git log --oneline -10
```

### Prevention

- Add agent result monitoring with trend analysis
- Set up canary testing for new models
- Implement automatic retry with exponential backoff

---

## 3. Webhook Delivery Failed

### Alert Condition

`stas_webhooks_failed_total` increases rapidly

### Severity

**Warning** — P2, respond within 15 minutes

### Triage (2 min)

```bash
# Check recent webhook deliveries
docker compose -f docker-compose.prod.yml logs --tail=50 stas-webhook | grep -i "webhook"

# Check GitHub App webhook dashboard
# https://github.com/settings/apps/<app-name>/advanced
```

### Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Webhook secret mismatch | Update `GITHUB_WEBHOOK_SECRET` |
| `500 Internal Server Error` | Application error | Check webhook logs |
| `ECONNRESET` | Network issue | Check connectivity |
| `ETIMEDOUT` | Slow response | Check server load |
| `signature does not match` | Secret rotation issue | Verify webhook secret |

### Remediation

#### Step 1: Verify Webhook Secret (1 min)

```bash
# Compare with GitHub App settings
grep GITHUB_WEBHOOK_SECRET .env
```

#### Step 2: Check Recent Failures (2 min)

```bash
docker compose -f docker-compose.prod.yml logs --tail=100 stas-webhook | grep -E "error|Error|fail|status: [45]"
```

#### Step 3: Test Webhook Delivery (2 min)

```bash
# Simulate a webhook (if smee or test tool available)
bash plugin/tools/stas-webhook-test.sh issues.labeled
```

#### Step 4: Redeliver Failed Webhooks (1 min)

```bash
# From GitHub App advanced settings, redeliver recent webhooks
# Or via API:
# gh api repos/<owner>/<repo>/hooks/<hook_id>/deliveries -q '.[0].id'
```

### Prevention

- Set up webhook delivery monitoring with latency tracking
- Implement webhook retry queue for transient failures
- Add webhook payload validation before processing

---

## 4. Worker Pool Empty

### Alert Condition

`stas_worker_count == 0` for > 2 minutes

### Severity

**Critical** — P1, respond within 5 minutes

### Triage (1 min)

```bash
# Check if workers are running
docker compose -f docker-compose.prod.yml ps stas-worker

# Check worker logs
docker compose -f docker-compose.prod.yml logs --tail=30 stas-worker
```

### Remediation

#### Step 1: Restart Workers (1 min)

```bash
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4 stas-worker
```

#### Step 2: Check for Crashes (2 min)

```bash
# Check exit codes
docker ps -a --filter "name=stas-worker" --format "table {{.Names}}\t{{.Status}}\t{{.ExitCode}}"

# Check OOM kills
docker compose -f docker-compose.prod.yml logs stas-worker | grep -i "killed\|OOM\|exit code 137"
```

#### Step 3: Check RabbitMQ Connection (1 min)

```bash
docker compose -f docker-compose.prod.yml exec rabbitmq rabbitmq-diagnostics check_port_connectivity
```

### Prevention

- Add Docker auto-restart policy (`restart: unless-stopped`)
- Set up worker health check with automatic replacement
- Monitor worker memory usage to prevent OOM

---

## 5. Rate Limit Exhausted

### Alert Condition

`stas_rate_limit_remaining == 0` for any tier

### Severity

**Warning** — P3, respond within 1 hour

### Triage (2 min)

```bash
# Check rate limit status
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/rate_limit | jq '.resources.core'

# Check per-tier limits
docker compose exec stas-postgres psql -U stas -c "
  SELECT account_tier, count(*) as accounts, sum(rate_limit) as total_capacity
  FROM accounts
  GROUP BY account_tier;
"
```

### Remediation

#### Step 1: Check for Abuse (2 min)

```bash
# Check recent webhook volume
docker compose -f docker-compose.prod.yml logs --tail=200 stas-webhook \
  | grep "webhook received" | wc -l

# Check per-repo distribution
docker compose exec stas-postgres psql -U stas -c "
  SELECT repo_name, count(*) as webhook_count
  FROM webhook_events
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY repo_name
  ORDER BY webhook_count DESC
  LIMIT 10;
"
```

#### Step 2: Increase Limits (1 min)

```bash
# For urgent cases, temporarily increase tier limits
docker compose exec stas-postgres psql -U stas -c "
  UPDATE accounts SET rate_limit = rate_limit * 2
  WHERE account_tier = 'pro' AND rate_limit < 100;
"
```

#### Step 3: Manual Reset (1 min)

```bash
# If counters are stuck, restart rate limit service
docker compose -f docker-compose.prod.yml restart stas-webhook
```

### Prevention

- Implement rate limit headroom alerts (warn at 80% capacity)
- Add auto-scaling rate limits based on usage patterns
- Distribute load across multiple GitHub Apps

---

## 6. Backup Stale

### Alert Condition

`last_successful_backup_age > 4 hours`

### Severity

**Warning** — P2, respond within 1 hour

### Triage (2 min)

```bash
# Check backup timestamps
ls -la /var/backups/postgres/daily/
ls -la /var/backups/redis/daily/
ls -la /var/backups/rabbitmq/daily/

# Check backup logs
cat /var/log/backup-postgres.log 2>/dev/null || echo "No log file"
```

### Remediation

#### Step 1: Run Manual Backup (1 min)

```bash
./scripts/backup-postgres.sh
./scripts/backup-redis.sh
./scripts/backup-rabbitmq.sh
```

#### Step 2: Check Scripts (2 min)

```bash
# Check for errors
bash -x ./scripts/backup-postgres.sh 2>&1 | tail -20

# Verify environment variables
grep -E "BACKUP_S3|DATABASE_URL|BACKUP_GPG" .env | head -5
```

#### Step 3: Check Disk Space (1 min)

```bash
df -h /var/backups/
```

### Prevention

- Add backup script monitoring with Prometheus metrics
- Set up backup health check endpoint
- Implement automatic retry for failed backups

---

## 7. Database Connection Pool Exhausted

### Alert Condition

PostgreSQL connections > 80% of `max_connections`

### Severity

**Warning** — P2, respond within 15 minutes

### Triage (2 min)

```bash
# Check connection count
docker compose exec stas-postgres psql -U stas -c "
  SELECT state, count(*) as connections
  FROM pg_stat_activity
  GROUP BY state;
"

# Check long-running queries
docker compose exec stas-postgres psql -U stas -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration,
         query, state
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC
  LIMIT 10;
"
```

### Remediation

#### Step 1: Kill Idle Connections (1 min)

```bash
docker compose exec stas-postgres psql -U stas -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE state = 'idle'
    AND state_change < NOW() - INTERVAL '5 minutes';
"
```

#### Step 2: Increase Pool Size (temporary fix)

```bash
# Update docker-compose.prod.yml or restart with env var
docker compose -f docker-compose.prod.yml stop stas-webhook stas-worker
docker compose -f docker-compose.prod.yml run -e PGPoolSize=50 -d stas-webhook
docker compose -f docker-compose.prod.yml up -d stas-worker
```

#### Step 3: Add PgBouncer (permanent fix)

```yaml
# Add to docker-compose.prod.yml
pgbouncer:
  image: edoburu/pgbouncer:latest
  environment:
    - DATABASE_URL=postgres://stas:password@stas-postgres:5432/stas
    - POOL_MODE=transaction
    - MAX_CLIENT_CONN=200
    - DEFAULT_POOL_SIZE=20
```

### Prevention

- Add PgBouncer connection pooling
- Set up connection pool monitoring
- Implement connection leak detection
