/**
 * Runs schema — individual fix-run attempts with full result metadata.
 *
 * Tracks every automated fix from start to completion, including
 * confidence scores, PR details, error information, and performance metrics.
 *
 * Status values: pending, running, completed, failed, cancelled
 */

import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { repos } from './repos.js';

export const runs = pgTable('runs', {
  id: serial('id').primaryKey(),
  /** Account that owns this run. */
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  /** Optional reference to the repo entry. */
  repoId: integer('repo_id')
    .references(() => repos.id, { onDelete: 'set null' }),
  /** GitHub issue number this run is fixing. */
  issueNumber: integer('issue_number'),
  /** Current status of the run. */
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  /** Agent's confidence level: high / medium / low. */
  confidence: varchar('confidence', { length: 20 }),
  /** Human-readable summary of the fix. */
  summary: text('summary'),
  /** URL of the pull request created. */
  prUrl: varchar('pr_url', { length: 500 }),
  /** Git branch created by the agent. */
  branchName: varchar('branch_name', { length: 255 }),
  /** Error details if the run failed. */
  error: text('error'),
  /** Total duration in milliseconds. */
  durationMs: integer('duration_ms'),
  /** Model identifier used (e.g. "anthropic/claude-sonnet-4-20250514"). */
  modelUsed: varchar('model_used', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
