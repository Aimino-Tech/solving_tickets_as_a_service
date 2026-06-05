/**
 * Database migration runner.
 *
 * Uses drizzle-kit under the hood to apply pending migrations.
 * Migration tracking is done via a `_migrations` table.
 *
 * Usage:
 *   npx tsx src/db/migrate.ts          # Run pending migrations
 *   npx tsx src/db/migrate.ts --rollback  # Roll back the last batch
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootLogger } from '../utils/logger.js';
import { closePool, getPool, queryWithRetry } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = rootLogger.child({ module: 'db:migrate' });

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATION_TABLE = '_migrations';

// ---------------------------------------------------------------------------
// Ensure the tracking table exists
// ---------------------------------------------------------------------------

async function ensureMigrationTable(): Promise<void> {
  await queryWithRetry(
    `CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64) NOT NULL
    )`,
  );
}

// ---------------------------------------------------------------------------
// Apply a single migration file
// ---------------------------------------------------------------------------

async function applyMigration(name: string, sql: string, checksum: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Run the migration SQL
    await client.query(sql);

    // Record the migration
    await client.query(`INSERT INTO "${MIGRATION_TABLE}" (name, checksum) VALUES ($1, $2)`, [name, checksum]);

    await client.query('COMMIT');
    log.info({ migration: name }, 'Migration applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err, migration: name }, 'Migration failed, rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Get applied migrations from the tracking table
// ---------------------------------------------------------------------------

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await queryWithRetry<{ name: string }>(`SELECT name FROM "${MIGRATION_TABLE}" ORDER BY id`);
  return new Set(result.rows.map((r) => r.name));
}

// ---------------------------------------------------------------------------
// Compute a simple checksum for a migration file
// ---------------------------------------------------------------------------

function computeChecksum(content: string): string {
  // Simple hash for integrity checking — not cryptographic
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Run pending migrations
// ---------------------------------------------------------------------------

export async function runMigrations(): Promise<void> {
  log.info('Checking for pending migrations...');

  if (!existsSync(MIGRATIONS_DIR)) {
    log.warn('Migrations directory does not exist, creating it');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return;
  }

  await ensureMigrationTable();
  const applied = await getAppliedMigrations();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    log.info('No migration files found');
    return;
  }

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log.info('All migrations are already applied');
    return;
  }

  log.info({ pending: pending.length }, `Found ${pending.length} pending migration(s)`);

  for (const file of pending) {
    const filePath = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(filePath, 'utf-8');
    const checksum = computeChecksum(sql);
    await applyMigration(file, sql, checksum);
  }
}

// ---------------------------------------------------------------------------
// Rollback the last batch of migrations
// ---------------------------------------------------------------------------

export async function rollbackLastBatch(): Promise<void> {
  log.info('Rolling back last migration batch...');

  await ensureMigrationTable();

  // Get the last batch — migrations applied in the same second are a "batch"
  const result = await queryWithRetry<{ name: string }>(
    `SELECT name FROM "${MIGRATION_TABLE}"
     WHERE applied_at = (
       SELECT applied_at FROM "${MIGRATION_TABLE}"
       ORDER BY applied_at DESC
       LIMIT 1
     )
     ORDER BY id DESC`,
  );

  if (result.rows.length === 0) {
    log.info('No migrations to roll back');
    return;
  }

  for (const row of result.rows) {
    const rollbackFile = join(MIGRATIONS_DIR, row.name.replace('.sql', '.rollback.sql'));
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      if (existsSync(rollbackFile)) {
        const sql = readFileSync(rollbackFile, 'utf-8');
        await client.query(sql);
        log.info({ migration: row.name }, 'Rollback SQL applied');
      } else {
        log.warn({ migration: row.name }, `No rollback file found for ${row.name}, skipping SQL rollback`);
      }

      // Remove the migration record
      await client.query(`DELETE FROM "${MIGRATION_TABLE}" WHERE name = $1`, [row.name]);

      await client.query('COMMIT');
      log.info({ migration: row.name }, 'Migration rolled back successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err, migration: row.name }, 'Rollback failed');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--rollback')) {
    await rollbackLastBatch();
  } else {
    await runMigrations();
  }

  await closePool();
  log.info('Migration complete');
}

// Run if executed directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    log.error({ err }, 'Migration failed');
    process.exit(1);
  });
}
