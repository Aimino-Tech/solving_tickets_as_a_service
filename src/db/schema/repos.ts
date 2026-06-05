/**
 * Repos schema — repositories tracked per account.
 *
 * Links GitHub repositories to an account/installation, enabling
 * per-repo run history and configuration.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const repos = pgTable('repos', {
  id: serial('id').primaryKey(),
  /** Repository owner (user or org login). */
  owner: varchar('owner', { length: 255 }).notNull(),
  /** Repository name. */
  name: varchar('name', { length: 255 }).notNull(),
  /** GitHub App installation ID that has access to this repo. */
  installationId: integer('installation_id').notNull(),
  /** Account that owns this repo record. */
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  /** When this repo was first enabled/added. */
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
