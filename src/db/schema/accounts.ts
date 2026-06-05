/**
 * Accounts schema — GitHub App installations and their owners.
 *
 * Each account represents a GitHub installation that has authorized the STAS app.
 * Tier determines credit pricing and rate limits.
 */

import { pgTable, serial, integer, varchar, timestamp } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  githubInstallationId: integer('github_installation_id').notNull().unique(),
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  tier: varchar('tier', { length: 50 }).notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
