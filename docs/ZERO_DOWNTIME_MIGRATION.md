# Zero-Downtime Database Migration Procedure

> **Last updated:** 2026-06-08
> **Applies to:** STAS PostgreSQL production deployments

## Overview

Zero-downtime migrations allow schema changes without service interruption.
The strategy depends on the type of migration:

| Migration Type | Strategy | Downtime | Risk |
|---|---|---|---|
| Add column (nullable) | Safe, online | None | Low |
| Add column (NOT NULL) | 2-phase: add nullable → backfill → add constraint | None | Medium |
| Add table | Safe, online | None | Low |
| Add index | `CREATE INDEX CONCURRENTLY` | None | Low |
| Rename column | 3-phase: add new → dual-write → drop old | None | High |
| Drop column | 3-phase: stop reads → drop → cleanup | None | Medium |
| Drop table | 3-phase: stop reads → drop → cleanup | None | Medium |
| Change column type | Add new → backfill → swap → drop old | None | High |

## General Principles

1. **Always have a rollback plan** — every forward migration must have a tested rollback
2. **Test in staging first** — run the full migration + rollback cycle against staging
3. **Use `--dry-run` in production first** — verify what will run before running it
4. **Run during low traffic** — schedule migrations for off-peak hours
5. **Monitor closely** — watch connection pool, query latency, error rates
6. **Keep migrations small** — one logical change per migration file
7. **Never edit a released migration** — create a new migration to fix issues

## Safe Migrations (No Downtime Required)

### Adding a Nullable Column

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferences JSONB;
```

- Safe: existing rows get `NULL`
- No locking issues with `IF NOT EXISTS`

### Adding a Table

```sql
CREATE TABLE IF NOT EXISTS new_table (
    id SERIAL PRIMARY KEY,
    ...
);
```

- `CREATE TABLE` is safe and non-blocking
- Use `IF NOT EXISTS` for idempotency

### Adding an Index

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name ON table_name(column);
```

- `CONCURRENTLY` avoids table-level locks
- Can take longer but doesn't block reads/writes
- Does not run in a transaction — handle rollback separately

> **Important:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction
> block. Our migrate.ts runner wraps each migration SQL in a transaction.
> For concurrent index creation, run them as separate statements outside
> the migration framework or use a helper script.

## Multi-Phase Migrations

### Adding a NOT NULL Column (2-Phase)

**Phase 1 — Add nullable + backfill:**

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan VARCHAR(50);
UPDATE accounts SET plan = 'free' WHERE plan IS NULL;
```

**Phase 2 — Add NOT NULL constraint:**

```sql
ALTER TABLE accounts ALTER COLUMN plan SET NOT NULL;
```

### Renaming a Column (3-Phase)

**Phase 1 — Add new column:**

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
```

**Phase 2 — Dual-write period:**
- Application code writes to both `name` and `display_name`
- Backfill: `UPDATE accounts SET display_name = name WHERE display_name IS NULL`
- Deploy updated application code

**Phase 3 — Drop old column:**

```sql
ALTER TABLE accounts DROP COLUMN IF EXISTS name;
```

> **Warning:** Column drops are irreversible. Ensure no application code
> references the old column before running Phase 3.

## Procedure for Running Migrations

### Step 1: Dry Run

```bash
# Show what will run without applying anything
npx tsx src/db/migrate.ts --dry-run
```

Expected output:
```
[INFO] Dry-run: checking pending migrations...
[INFO] Migration: 006_add_preferences.sql [PENDING]
[INFO] Dry-run: 1 migration(s) pending
```

### Step 2: Run Migrations

```bash
# Apply all pending migrations
npx tsx src/db/migrate.ts
```

### Step 3: Verify

```bash
# Check the _migrations tracking table
psql $DATABASE_URL -c "SELECT name, applied_at FROM _migrations ORDER BY id;"
```

### Step 4: Benchmark (Optional)

```bash
# Measure migration timing
npx tsx scripts/bench-migrations.ts
```

### Step 5: Rollback (If Needed)

```bash
# Roll back the last batch of migrations
npx tsx src/db/migrate.ts --rollback
```

Or dry-run first:

```bash
npx tsx src/db/migrate.ts --rollback-dry-run
```

## Rollback Strategy

### Automatic Rollback (in migrate.ts)

Each migration runs inside a transaction. If the SQL fails, the transaction
is rolled back automatically by the runner. The `_migrations` tracking table
is not updated on failure.

### Manual Rollback

If a migration succeeds but causes issues:

1. **Dry-run the rollback first:**
   ```bash
   npx tsx src/db/migrate.ts --rollback-dry-run
   ```

2. **Roll back the last batch:**
   ```bash
   npx tsx src/db/migrate.ts --rollback
   ```

3. **Verify the rollback:**
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM _migrations;"
   # Should return fewer entries
   ```

### Full Rollback (All Migrations)

For disaster recovery, roll back all migrations:

```bash
# Roll back batches until _migrations is empty
npx tsx scripts/test-migrations.ts --down
```

## Connection Pool Considerations

During migrations, be aware of connection pool limits:

```env
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
```

Migration scripts acquire connections from the pool. If a migration is
long-running, it may exhaust the pool and impact application availability.

**Recommendations:**
- Increase `DATABASE_POOL_MAX` temporarily during migration windows
- Use `CREATE INDEX CONCURRENTLY` outside transactions for large tables
- Monitor active connections: `SELECT * FROM pg_stat_activity;`

## Testing Migrations

### Unit Tests

```bash
# Run migration unit tests (mocked DB)
npx vitest run src/__tests__/db/migration.test.ts
```

### Integration Tests

```bash
# Run full migration lifecycle against real/embedded database
npx vitest run src/__tests__/db/migrations.test.ts
```

### Script-based Testing

```bash
# Full forward + rollback cycle against real DB
npx tsx scripts/test-migrations.ts

# Check integrity only (no database needed)
npx tsx scripts/test-migrations.ts --check

# Forward only
npx tsx scripts/test-migrations.ts --up

# Rollback only
npx tsx scripts/test-migrations.ts --down
```

## CI/CD Integration

Migration integrity checks are run in CI:

```yaml
- name: Migration integrity check
  run: npx tsx scripts/test-migrations.ts --check
```

Migration timing benchmarks:

```yaml
- name: Migration benchmark
  run: npx tsx scripts/bench-migrations.ts --ci --json
```

## Troubleshooting

### Migration fails with "relation already exists"

- Migration was partially applied. Check `_migrations` table.
- Use `IF NOT EXISTS` in CREATE statements for idempotency.

### Migration is very slow (>5s)

- Large data backfills (`UPDATE` on millions of rows)
- Index creation without `CONCURRENTLY`
- Long-running transactions blocking other queries

### Can't connect to database during migration

- Check `DATABASE_URL` environment variable
- Verify pool settings: `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX`
- Check if `pg_isready` responds

### Rollback fails

- A later migration may depend on the table/column being dropped
- Cascade drops may affect unexpected tables
- Check foreign key dependencies before rolling back

## References

- [PostgreSQL ALTER TABLE documentation](https://www.postgresql.org/docs/current/sql-altertable.html)
- [Zero-downtime migrations best practices](https://wiki.postgresql.org/wiki/Zero_downtime_migrations)
- [migrate.ts](../src/db/migrate.ts) — Migration runner source
- [migration.test.ts](../src/__tests__/db/migration.test.ts) — Unit tests
- [migrations.test.ts](../src/__tests__/db/migrations.test.ts) — Integration tests
- [test-migrations.ts](../scripts/test-migrations.ts) — Test runner script
