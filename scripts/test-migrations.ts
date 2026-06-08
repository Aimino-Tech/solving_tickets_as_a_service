#!/usr/bin/env tsx
/**
 * Database Migration Test Script
 *
 * Tests all migrations forward and backward against a real PostgreSQL database.
 * Requires DATABASE_URL to be set in environment or .env file.
 *
 * Usage:
 *   npx tsx scripts/test-migrations.ts            # Test all migrations
 *   npx tsx scripts/test-migrations.ts --up       # Test forward only
 *   npx tsx scripts/test-migrations.ts --down     # Test rollback only
 *   npx tsx scripts/test-migrations.ts --check    # Check file integrity only
 *
 * What it does:
 *   1. Checks migration file integrity (pairing, naming, SQL validity)
 *   2. Runs all forward migrations against the database
 *   3. Verifies the _migrations tracking table has all expected entries
 *   4. Rolls back all migrations
 *   5. Verifies the _migrations tracking table is empty
 *   6. Re-applies migrations to restore state (unless --no-restore)
 */

import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

// ---------------------------------------------------------------------------
// Colors for console output
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function ok(msg: string): void {
  console.log(`${GREEN}  [PASS]${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.log(`${RED}  [FAIL]${RESET} ${msg}`);
}

function info(msg: string): void {
  console.log(`${CYAN}  [INFO]${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${YELLOW}  [WARN]${RESET} ${msg}`);
}

function header(msg: string): void {
  console.log(`\n${CYAN}═══ ${msg} ═══${RESET}`);
}

// ---------------------------------------------------------------------------
// 1. File integrity checks (no DB needed)
// ---------------------------------------------------------------------------

let integrityPassed = false;

function checkFileIntegrity(): boolean {
  header('Migration File Integrity');

  let allPassed = true;

  if (!existsSync(MIGRATIONS_DIR)) {
    fail(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return false;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const forwardFiles = files.filter((f) => !f.includes('.rollback.'));
  const rollbackFiles = files.filter((f) => f.includes('.rollback.'));

  if (forwardFiles.length === 0) {
    fail('No forward migration files found');
    return false;
  }
  ok(`Found ${forwardFiles.length} forward migration(s)`);

  // Check every forward has a rollback
  for (const fwd of forwardFiles) {
    const expectedRollback = fwd.replace('.sql', '.rollback.sql');
    if (!rollbackFiles.includes(expectedRollback)) {
      fail(`Missing rollback file: ${expectedRollback}`);
      allPassed = false;
    } else {
      ok(`Forward + rollback pair: ${fwd}`);
    }
  }

  // Check naming convention
  const fwdPattern = /^\d{3}_.+\.sql$/;
  const rbPattern = /^\d{3}_.+\.rollback\.sql$/;
  for (const f of forwardFiles) {
    if (!fwdPattern.test(f)) {
      fail(`Invalid forward filename (expected NNN_description.sql): ${f}`);
      allPassed = false;
    }
  }
  for (const f of rollbackFiles) {
    if (!rbPattern.test(f)) {
      fail(`Invalid rollback filename (expected NNN_description.rollback.sql): ${f}`);
      allPassed = false;
    }
  }

  // Check ordering
  const numbers = forwardFiles.map((f) => parseInt(f.slice(0, 3), 10));
  const sorted = [...numbers].sort((a, b) => a - b);
  if (JSON.stringify(numbers) !== JSON.stringify(sorted)) {
    fail('Migrations are not in sequential order');
    allPassed = false;
  } else {
    ok('Migrations are in sequential order');
  }

  // Check file content
  for (const f of forwardFiles) {
    const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
    if (content.trim().length === 0) {
      fail(`Forward migration is empty: ${f}`);
      allPassed = false;
    }
  }

  for (const f of rollbackFiles) {
    const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
    if (content.trim().length === 0) {
      fail(`Rollback file is empty: ${f}`);
      allPassed = false;
    }
    if (!/\bDROP\b/i.test(content)) {
      warn(`Rollback file may not drop anything: ${f}`);
    }
  }

  if (allPassed) {
    ok('All file integrity checks passed');
  }

  integrityPassed = allPassed;
  return allPassed;
}

// ---------------------------------------------------------------------------
// 2. Database-dependent tests
// ---------------------------------------------------------------------------

async function runForwardMigrations(): Promise<number> {
  header('Running Forward Migrations');

  const { runMigrations, closePool } = await import('../src/db/migrate.js');
  await runMigrations();
  await closePool();

  info('Forward migrations completed');
  return 0;
}

async function verifyMigrationsApplied(): Promise<number> {
  header('Verifying Migrations Applied');

  const { getPool, closePool } = await import('../src/db/connection.js');
  const pool = getPool();

  const result = await pool.query(
    'SELECT name FROM "_migrations" ORDER BY id',
  );
  const applied = result.rows.map((r: any) => r.name);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('.rollback.'))
    .sort();

  info(`Applied in DB: ${applied.length}, Expected: ${files.length}`);

  let allMatch = true;
  for (const f of files) {
    if (applied.includes(f)) {
      ok(`Verified: ${f}`);
    } else {
      fail(`Missing from tracking table: ${f}`);
      allMatch = false;
    }
  }

  await closePool();
  return allMatch ? 0 : 1;
}

async function rollbackAllMigrations(): Promise<number> {
  header('Rolling Back All Migrations');

  const { getPool, queryWithRetry, closePool } = await import('../src/db/connection.js');
  const { rollbackLastBatch } = await import('../src/db/migrate.js');

  // Rollback in batches until none remain
  let batchCount = 0;
  while (true) {
    const checkResult = await queryWithRetry<{ cnt: string }>(
      'SELECT COUNT(*)::text AS cnt FROM "_migrations"',
    );
    const remaining = parseInt(checkResult.rows[0]?.cnt ?? '0', 10);
    if (remaining === 0) break;

    info(`Rolling back batch (${remaining} migrations remaining)...`);
    await rollbackLastBatch();
    batchCount++;
  }

  await closePool();
  info(`Rolled back ${batchCount} batch(es)`);
  return 0;
}

async function verifyMigrationsRolledBack(): Promise<number> {
  header('Verifying Migrations Rolled Back');

  const { getPool, closePool } = await import('../src/db/connection.js');
  const pool = getPool();

  const result = await pool.query(
    'SELECT COUNT(*)::text AS cnt FROM "_migrations"',
  );
  const count = parseInt(result.rows[0]?.cnt ?? '0', 10);

  if (count === 0) {
    ok('Migration tracking table is empty');
    await closePool();
    return 0;
  }

  fail(`Migration tracking table still has ${count} entries`);
  await closePool();
  return 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--up') ? 'up' :
               args.includes('--down') ? 'down' :
               args.includes('--check') ? 'check' :
               'full';
  const noRestore = args.includes('--no-restore');

  console.log(`${CYAN}═══════════════════════════════════════════${RESET}`);
  console.log(`${CYAN}  Database Migration Test Suite${RESET}`);
  console.log(`${CYAN}═══════════════════════════════════════════${RESET}`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Migrations: ${MIGRATIONS_DIR}\n`);

  let exitCode = 0;

  // Step 1: Always check file integrity
  if (!checkFileIntegrity()) {
    exitCode = 1;
    if (mode === 'full' || mode === 'check') {
      console.log(`\n${RED}File integrity checks failed. Aborting.${RESET}`);
      process.exit(exitCode);
    }
    warn('File integrity has issues, but continuing with --up/--down mode');
  }

  if (mode === 'check') {
    console.log(`\n${GREEN}Check mode complete.${RESET}`);
    process.exit(exitCode);
  }

  // Step 2: Database tests
  const dbUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/stas';
  info(`Using database: ${dbUrl.replace(/\/\/.*@/, '//***@')}`);

  try {
    if (mode === 'full' || mode === 'up') {
      exitCode += await runForwardMigrations();
      exitCode += await verifyMigrationsApplied();
    }

    if (mode === 'full' || mode === 'down') {
      exitCode += await rollbackAllMigrations();
      exitCode += await verifyMigrationsRolledBack();
    }

    // Re-apply if in full mode (to restore DB state)
    if (mode === 'full' && !noRestore) {
      info('Re-applying migrations to restore database state...');
      exitCode += await runForwardMigrations();
      exitCode += await verifyMigrationsApplied();
    }

    if (mode === 'full' && noRestore) {
      warn('--no-restore: migrations left rolled back');
    }
  } catch (err) {
    console.error(`\n${RED}Migration test failed:${RESET}`, err);
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log(`\n${GREEN}All migration tests passed!${RESET}\n`);
  } else {
    console.log(`\n${RED}Some migration tests failed (exit code: ${exitCode})${RESET}\n`);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
