/**
 * Repos schema — repositories tracked per account.
 *
 * Links GitHub repositories to an account/installation, enabling
 * per-repo run history and configuration.
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
