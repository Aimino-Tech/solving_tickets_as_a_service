/**
 * Run history schema — records every fix run from start to completion.
 *
 * Status values: pending, running, completed, failed, cancelled
 */

import { pgTable, serial, integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const runHistory = pgTable('run_history', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  issueId: integer('issue_id'),
  repo: varchar('repo', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  result: text('result'), // JSON string with run result details
});

export type RunHistory = typeof runHistory.$inferSelect;
export type NewRunHistory = typeof runHistory.$inferInsert;
