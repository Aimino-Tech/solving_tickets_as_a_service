/**
 * Repos schema — repository tracking per account.
 *
 * Each row represents a GitHub repository that has been enabled
 * for STAS processing by a given account.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const repos = pgTable('repos', {
  id: serial('id').primaryKey(),
  owner: varchar('owner', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  installationId: integer('installation_id').notNull(),
  accountId: integer('account_id').notNull(),
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
