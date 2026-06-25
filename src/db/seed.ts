/**
 * Database seed script.
 *
 * Seeds the database with initial data for development/testing.
 *
 * Usage:
 *   npx tsx src/db/seed.ts
 */

import { getPool, closePool } from './connection.js';
import { runMigrations } from './migrate.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'db:seed' });

async function seed(): Promise<void> {
  log.info('Starting database seed...');

  // Ensure migrations are applied first
  await runMigrations();

  const pool = getPool();

  // Check if seed data already exists
  const existing = await pool.query('SELECT COUNT(*) AS count FROM accounts');
  const count = parseInt(existing.rows[0]?.count ?? '0', 10);

  if (count > 0) {
    log.info({ accountCount: count }, 'Database already seeded, skipping');
    await closePool();
    return;
  }

  log.info('No existing data found, creating seed data...');

  // Create a demo account
  const accountResult = await pool.query(
    `INSERT INTO accounts (github_installation_id, email, name, tier)
     VALUES (12345678, 'demo@example.com', 'Demo Account', 'pro')
     RETURNING id`,
  );
  const accountId = accountResult.rows[0].id;

  // Create initial credit balance
  await pool.query(
    `INSERT INTO credit_balances (account_id, balance, lifetime_credits)
     VALUES ($1, 1000, 1000)`,
    [accountId],
  );

  // Record initial credit transaction
  await pool.query(
    `INSERT INTO credit_transactions (account_id, amount, type, description)
     VALUES ($1, 1000, 'adjustment', 'Initial seed credits for development')`,
    [accountId],
  );

  // Create some sample usage records
  await pool.query(
    `INSERT INTO usage_records (account_id, issue_id, repo, action, credits_used)
     VALUES
       ($1, 101, 'owner/sample-repo', 'fix_run', 50),
       ($1, 102, 'owner/sample-repo', 'triage', 10),
       ($1, 103, 'owner/sample-repo', 'fix_run', 100)`,
    [accountId],
  );

  // Create a sample run history
  await pool.query(
    `INSERT INTO run_history (installation_id, repo_owner, repo_name, issue_number, status, created_at, updated_at, summary)
     VALUES
       ($1, 'owner', 'sample-repo', 101, 'completed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '50 minutes', 'Fix applied successfully'),
       ($1, 'owner', 'sample-repo', 102, 'failed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'Test suite failed')`,
    [accountId],
  );

  // Log the seed
  await pool.query(
    `INSERT INTO audit_logs (account_id, action, details)
     VALUES ($1, 'database_seeded', 'Initial seed data created for development')`,
    [accountId],
  );

  log.info({ accountId }, 'Database seeded successfully');

  await closePool();
}

seed().catch((err) => {
  log.error({ err }, 'Database seed failed');
  process.exit(1);
});
