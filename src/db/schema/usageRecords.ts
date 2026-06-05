/**
 * Usage records schema — tracks credits consumed per fix run.
 *
 * Each row represents a single agent execution or action.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const usageRecords = pgTable('usage_records', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  issueId: integer('issue_id'),
  repo: varchar('repo', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(), // e.g. "fix_run", "triage", "sandbox"
  creditsUsed: integer('credits_used').notNull().default(0),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
