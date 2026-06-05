/**
 * Teams schema — account groupings for multi-tenant collaboration.
 *
 * Each team can contain multiple account_ids, enabling shared repo access
 * and consolidated billing across team members.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  /** Array of account IDs that belong to this team. */
  accountIds: integer('account_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
