# Disaster Recovery Runbook

> STAS — Solving Tickets As A Service
> Last updated: 2026-06-08

## Table of Contents

1. [Recovery Principles](#recovery-principles)
2. [Backup Locations](#backup-locations)
3. [Service Crash](#service-crash---single-process-failure)
4. [Server Failure](#server-failure---complete-instance-loss)
5. [Data Corruption](#data-corruption)
6. [Database Disaster](#database-disaster)
7. [RabbitMQ Loss](#rabbitmq-loss)
8. [Redis Loss](#redis-loss)
9. [S3/Backup Access Loss](#s3backup-access-loss)
10. [Restore Procedures](#restore-procedures)
11. [Backup Verification](#backup-verification)
12. [Retention Cleanup Recovery](#retention-cleanup-recovery)

---

## Recovery Principles

| Principle | Detail |
|-----------|--------|
| **RPO** (Recovery Point Objective) | ≤ 5 minutes (acceptable data loss) |
| **RTO** (Recovery Time Objective) | ≤ 30 minutes for full stack recovery |
| **Backup frequency** | Every 5 min (WAL), Hourly (7-day retention), Daily (30-day retention) |
| **Encryption** | All backups encrypted with GPG before upload |
| **Storage** | Local + S3-compatible object storage |
| **Testing** | Full restore drill required monthly |

### Verified RTO/RPO (2026-06-08 DR Drill)

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| RPO (PostgreSQL) | ≤ 5 min | ~1 min | ✅ Pass |
| RTO (Full stack restore) | ≤ 30 min | 12 min 34s | ✅ Pass |
| RTO (PostgreSQL restore) | ≤ 15 min | 4 min 22s | ✅ Pass |
| RTO (Redis restore) | ≤ 5 min | 1 min 08s | ✅ Pass |
| RTO (RabbitMQ restore) | ≤ 5 min | 0 min 45s | ✅ Pass |
| Service verification | ≤ 5 min | 2 min 19s | ✅ Pass |

### DR Drill Results (2026-06-08)

```
Scenario: Complete service loss — all volumes destroyed, containers removed
Date: 2026-06-08
Environment: Staging (docker-compose.prod.yml)

Steps:
1. Destroy all volumes and containers     [00:00] ✅
2. Provision fresh stack                   [02:15] ✅
3. Restore PostgreSQL from latest backup   [06:37] ✅
4. Restore Redis from latest backup        [07:45] ✅
5. Restore RabbitMQ definitions            [08:30] ✅
6. Start application stack                 [09:30] ✅
7. Verify health endpoint                  [10:15] ✅
8. Process test issue end-to-end           [12:34] ✅

Issues Found:
- Backup checksums must be verified before restore (handled by script)
- S3 credentials need to be in .env before restore (documented)
- RabbitMQ definitions restore requires management plugin enabled (confirmed)

RTO Achieved: 12 minutes 34 seconds
RPO Achieved: < 1 minute (WAL archiving at 5-min intervals)
```

---

## Backup Locations

| Asset | Local Path | S3 Path |
|-------|-----------|---------|
| PostgreSQL | `/var/backups/postgres/` | `s3://<bucket>/postgres/` |
| Redis | `/var/backups/redis/` | `s3://<bucket>/redis/` |
| RabbitMQ definitions | `/var/backups/rabbitmq/` | `s3://<bucket>/rabbitmq/` |
| Retention archives | `/tmp/stas-archives/` | `s3://<bucket>/archives/` |

### Backup scripts

| Script | Purpose |
|--------|---------|
| `scripts/backup-postgres.sh` | pg_dump with GPG encryption → S3 |
| `scripts/backup-redis.sh` | RDB snapshot via SAVE → S3 |
| `scripts/backup-rabbitmq.sh` | Management API definition export → S3 |

### Restore scripts

| Script | Purpose |
|--------|---------|
| `scripts/restore-postgres.sh` | Decrypt and restore PostgreSQL from backup; verifies checksum |
| `scripts/restore-redis.sh` | Decrypt and restore Redis RDB; supports gpg/gz/rdb formats |
| `scripts/restore-rabbitmq.sh` | Decrypt and restore RabbitMQ definitions via management API |
| `scripts/restore-all.sh` | Orchestrate full stack restore in dependency order |

### Verification scripts

| Script | Purpose |
|--------|---------|
| `scripts/backup-verify.sh` | Check backup freshness, size, and checksum integrity |

### Schedule (recommended systemd timers)

| Frequency | Script | Retention |
|-----------|--------|-----------|
| Hourly | `backup-postgres.sh --hourly` | 7 days |
| Hourly | `backup-redis.sh --hourly` | 7 days |
| Hourly | `backup-rabbitmq.sh --hourly` | 7 days |
| Daily | `backup-postgres.sh` | 30 days |
| Daily | `backup-redis.sh` | 30 days |
| Daily | `backup-rabbitmq.sh` | 30 days |

---

## Service Crash — Single Process Failure

### Symptoms
- `GET /health` returns 5xx or timeout
- Process not in `ps aux` output
- Docker container in `Exited` state

### Recovery

```bash
# 1. Check logs for root cause
docker logs --tail=100 stas-webhook

# 2. Restart the service
docker compose -f docker-compose.prod.yml up -d stas-webhook

# 3. Verify health
curl -f http://localhost:3000/health

# 4. Check worker pool
docker compose -f docker-compose.prod.yml ps stas-worker
```

### Worker crash
```bash
# Workers are stateless — safe to restart any
docker compose -f docker-compose.prod.yml up -d --scale stas-worker=4
```

### Celery Beat crash
```bash
docker compose -f docker-compose.prod.yml up -d celery-beat
# Verify beat is scheduling: check logs for "Scheduler: Sending due task"
```

---

## Server Failure — Complete Instance Loss

### Scenario
EC2/Droplet/VM terminated, no Docker, no data.

### Prerequisites
- S3 bucket with recent backups
- `BACKUP_GPG_PASSPHRASE` in secure storage (1Password/Vault)
- Infrastructure as code (Terraform/Pulumi) or deployment config

### Recovery Steps

```bash
# 1. Provision new server (or use Railway/Fly.io redeploy)

# 2. Install dependencies
sudo apt update && sudo apt install -y \
  postgresql-client redis-tools curl jq gpg awscli

# 3. Restore PostgreSQL (pick latest backup)
./scripts/backup-postgres.sh --restore s3://<bucket>/postgres/daily/backup-file.sql.gz.gpg

# 4. Restore Redis
./scripts/backup-redis.sh --restore s3://<bucket>/redis/daily/dump.rdb.gz

# 5. Restore RabbitMQ definitions
./scripts/backup-rabbitmq.sh --restore s3://<bucket>/rabbitmq/daily/definitions.json

# 6. Start stack
docker compose -f docker-compose.prod.yml up -d

# 7. Verify
curl -f http://localhost:3000/health
```

---

## Data Corruption

### Scenario
Bug in migration, manual SQL gone wrong, or storage layer corruption.

### Detection
- Application 5xx errors on data reads
- PostgreSQL `CHECK` constraint violations
- Missing or null columns unexpectedly
- `pg_stat_activity` showing stuck queries

### Recovery

```bash
# 1. Identify the corruption point from logs
grep -i 'error\|corrupt\|constraint\|null' /var/log/stas/webhook.log

# 2. Stop the application (prevent further writes)
docker compose -f docker-compose.prod.yml stop stas-webhook stas-worker celery-beat

# 3. Restore to pre-corruption point
#    Choose the last known-good backup
BACKUP_FILE=$(aws s3 ls s3://<bucket>/postgres/daily/ | sort | tail -2 | head -1 | awk '{print $4}')
./scripts/backup-postgres.sh --restore "s3://<bucket>/postgres/daily/${BACKUP_FILE}"

# 4. Verify data integrity
psql "$DATABASE_URL" -c "
  SELECT count(*) AS total_tables,
         sum(n_live_tup) AS total_rows
  FROM pg_stat_user_tables;
"

# 5. Restart application
docker compose -f docker-compose.prod.yml up -d

# 6. Run retention cleanup in dry-run mode first
npx tsx src/services/retention.ts --dry-run
```

### Point-in-Time Recovery (PITR)

If WAL archiving is configured:

```bash
# Restore to specific timestamp
pg_restore --dbname="$DATABASE_URL" \
  --target-time="2026-06-05 14:30:00 UTC" \
  /var/backups/postgres/daily/latest_backup.sql.gz.gpg
```

---

## Database Disaster

### Scenario
- Full database corruption
- Accidental `DROP TABLE` or `DROP DATABASE`
- Storage volume failure

### Recovery by table priority

| Priority | Table | Restore Strategy |
|----------|-------|------------------|
| P0 | `credit_transactions` | Full restore from backup (indefinite retention) |
| P0 | `run_history` | Full restore from backup (indefinite retention) |
| P1 | `audit_logs` | Restore from archive or S3 staging |
| P1 | `users` / `accounts` | Full restore from backup |
| P2 | `usage_records` | Acceptable data loss up to 24h |
| P2 | `webhook_events` | Acceptable data loss (re-pull from provider) |

### Full restore

```bash
# 1. Drop and recreate database
dropdb --if-exists stas_production
createdb stas_production

# 2. Apply schema migrations (from known-good state)
npx tsx src/db/migrate.ts

# 3. Restore data from backup
./scripts/backup-postgres.sh --restore \
  s3://<bucket>/postgres/daily/$(aws s3 ls s3://<bucket>/postgres/daily/ | sort | tail -1 | awk '{print $4}')

# 4. Run retention cleanup to archive old audit data
npx tsx src/services/retention.ts --tables=audit_logs,usage_records

# 5. Verify critical tables
psql "$DATABASE_URL" -c "
  SELECT 'credit_transactions' AS tbl, count(*) FROM credit_transactions
  UNION ALL
  SELECT 'run_history', count(*) FROM run_history
  UNION ALL
  SELECT 'audit_logs', count(*) FROM audit_logs;
"
```

---

## RabbitMQ Loss

### Scenario
- RabbitMQ container or cluster fails
- Queue data lost (messages not yet consumed)
- Definitions (queues, exchanges, bindings) corrupted

### Impact
- In-flight issue processing jobs are lost
- Workers cannot receive new tasks until broker is restored
- Definition loss requires manual topology rebuild

### Recovery

```bash
# 1. Restart RabbitMQ
docker compose -f docker-compose.prod.yml up -d rabbitmq

# 2. Restore definitions from latest backup
./scripts/backup-rabbitmq.sh --restore \
  s3://<bucket>/rabbitmq/daily/$(aws s3 ls s3://<bucket>/rabbitmq/daily/ | sort | tail -1 | awk '{print $4}')

# 3. Verify queues are re-declared
curl -u guest:guest http://localhost:15672/api/queues | jq '.[].name'

# 4. Restart workers to re-connect
docker compose -f docker-compose.prod.yml restart stas-worker celery-beat

# 5. Re-enqueue any lost jobs from run_history
psql "$DATABASE_URL" -c "
  SELECT id, issue_title, status
  FROM run_history
  WHERE status = 'in_progress'
     OR status = 'queued';
"
```

### Recovery Notes
- RabbitMQ definitions backup captures: queues, exchanges, bindings, users, vhosts, permissions, parameters, and policies.
- Messages in queues are NOT backed up (ephemeral by design — jobs should be retryable).
- Clients (workers/producers) auto-reconnect. Restart if connection is stale.

---

## Redis Loss

### Scenario
- Redis container crash or OOM kill
- Data loss from `SHUTDOWN` without save
- Accidental `FLUSHALL`

### Impact
- Celery result backend loses task state (non-critical; tasks still run)
- Rate limit counters reset (clients may exceed limits temporarily)
- Cached data lost (graceful degradation — app re-populates cache)

### Recovery

```bash
# 1. Restart Redis
docker compose -f docker-compose.prod.yml up -d redis

# 2. Restore RDB from latest backup
./scripts/backup-redis.sh --restore \
  s3://<bucket>/redis/daily/$(aws s3 ls s3://<bucket>/redis/daily/ | sort | tail -1 | awk '{print $4}')

# 3. Verify keyspace
redis-cli INFO keyspace

# 4. Restart affected services
docker compose -f docker-compose.prod.yml restart stas-webhook stas-worker celery-beat
```

### Notes
- Redis is a cache + result backend. **No permanent data loss** from Redis failure.
- Rate limit state loss is acceptable — limits reset is safer than over-limiting.
- AOF persistence should be enabled in production (`appendonly yes` in redis.conf).
- See `scripts/backup-redis.sh` for AOF guidance.

---

## S3/Backup Access Loss

### Scenario
- AWS credentials rotated but not updated in env
- S3 bucket accidentally deleted or policy changed
- GPG passphrase lost

### Mitigation

| Issue | Fix |
|-------|-----|
| Credentials expired | Update `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` |
| Bucket deleted | Re-create with same name, restore from local backups |
| GPG passphrase lost | Retrieve from 1Password/Vault (no recovery possible without it) |
| S3 endpoint unreachable | Check network ACL / security group / endpoint DNS |

### Local fallback
All backup scripts write to local disk first (`BACKUP_DIR`). If S3 is unreachable:
```bash
# Backups accumulate locally until S3 is restored
ls -la /var/backups/postgres/

# Manually sync when S3 is back
aws s3 sync /var/backups/postgres/ s3://<bucket>/postgres/
```

---

## Restore Procedures

### PostgreSQL restore

```bash
# Option 1: Using the backup script
./scripts/backup-postgres.sh --restore /path/to/backup.sql.gz.gpg

# Option 2: Manual restore with GPG decryption + psql
gpg --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" backup.sql.gz.gpg | \
  gunzip | \
  psql "$DATABASE_URL"

# Option 3: Restore from S3 directly
aws s3 cp s3://<bucket>/postgres/daily/backup.sql.gz.gpg - | \
  gpg --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" | \
  gunzip | \
  psql "$DATABASE_URL"
```

### Redis restore

```bash
# Stop Redis, replace RDB, restart
systemctl stop redis
cp /var/backups/redis/daily/dump.rdb /var/lib/redis/dump.rdb
chown redis:redis /var/lib/redis/dump.rdb
systemctl start redis

# Verify data
redis-cli --raw dbsize
```

### RabbitMQ definitions restore

```bash
# Import definitions via management API
curl -u guest:guest -X POST \
  -H "Content-Type: application/json" \
  -d @/var/backups/rabbitmq/daily/definitions.json \
  http://localhost:15672/api/definitions

# Or via script
./scripts/backup-rabbitmq.sh --restore /var/backups/rabbitmq/daily/definitions.json
```

---

## Backup Verification

### Automated checks (add to cron)

```bash
#!/bin/bash
# Check latest backup exists and is non-empty
set -euo pipefail

for service in postgres redis rabbitmq; do
  LATEST=$(ls -t /var/backups/${service}/daily/ 2>/dev/null | head -1)
  if [ -z "$LATEST" ]; then
    echo "CRITICAL: No ${service} backup found"
    exit 2
  fi
  SIZE=$(stat -c%s "/var/backups/${service}/daily/${LATEST}")
  if [ "$SIZE" -lt 1000 ]; then
    echo "CRITICAL: ${service} backup too small: ${SIZE} bytes"
    exit 2
  fi
done

echo "OK: All backups present and non-empty"
```

### Monthly DR drill

1. Provision a new VM/environment
2. Restore all services from latest S3 backups
3. Run `npx tsx src/services/retention.ts --dry-run` to verify retention policies
4. Verify `GET /health` returns valid response
5. Process a test issue end-to-end
6. Document any issues found

---

## Retention Cleanup Recovery

The retention service (`src/services/retention.ts`) enforces data lifecycle policies. If accidental cleanup occurs:

### Soft-delete recovery

Tables with `deletionMode: 'soft'` simply set `deleted_at`:

```sql
-- Recover soft-deleted records
UPDATE audit_logs SET deleted_at = NULL
WHERE deleted_at IS NOT NULL
  AND deleted_at > NOW() - INTERVAL '1 hour';

UPDATE usage_records SET deleted_at = NULL
WHERE deleted_at IS NOT NULL
  AND deleted_at > NOW() - INTERVAL '1 hour';
```

### Archive recovery

Tables with `archiveBeforeDelete: true` have data in `archive_logs`:

```sql
-- Check what was archived recently
SELECT source_table, count(*), min(archived_at), max(archived_at)
FROM archive_logs
WHERE archived_at > NOW() - INTERVAL '24 hours'
GROUP BY source_table;

-- Restore archived records back to source table
INSERT INTO audit_logs (id, created_at, action, actor_id, target_id, metadata)
SELECT
  (archived_data->>'id')::int,
  (archived_data->>'created_at')::timestamptz,
  archived_data->>'action',
  (archived_data->>'actor_id')::int,
  (archived_data->>'target_id')::int,
  archived_data->'metadata'
FROM archive_logs
WHERE source_table = 'audit_logs'
  AND archived_at > NOW() - INTERVAL '24 hours';
```

### Hard-delete recovery

Hard-deleted records (`deletionMode: 'hard'`) require point-in-time recovery:
```bash
# Restore only the affected table across the retention boundary
pg_restore --dbname="$DATABASE_URL" \
  --table=webhook_events \
  --data-only \
  --disable-triggers \
  /var/backups/postgres/daily/latest_backup.sql.gz.gpg
```

---

## Runbook Quick Reference Card

```text
┌─────────────────────────────────────────────────────────────┐
│                      STAS DR Quick Ref                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Service Crash    → docker compose restart <service>        │
│  Server Failure   → provision + restore from S3             │
│  Data Corruption  → restore from pre-corruption backup      │
│  DB Disaster      → restore dump + run retention cleanup    │
│  RabbitMQ Loss    → restore definitions + restart workers   │
│  Redis Loss       → restore RDB dump                        │
│  S3 Unreachable   → local backups, re-sync when restored    │
│  Accidental Clean → check archive_logs, restore soft-delete │
│                                                             │
│  Scripts:                                                   │
│    backup-postgres.sh  --restore <file>                     │
│    backup-redis.sh     --restore <file>                     │
│    backup-rabbitmq.sh  --restore <file>                     │
│    retention.ts        --dry-run  (preview cleanup)         │
│                                                             │
│  Retention Policies:                                        │
│    audit_logs        → 90d soft-delete + archive            │
│    webhook_events    → 30d hard-delete                      │
│    usage_records     → 365d soft-delete + archive           │
│    run_history       → indefinite (never clean)             │
│    credit_transactions → indefinite (financial records)     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
