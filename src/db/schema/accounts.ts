/**
 * Accounts schema — GitHub App installations and their owners.
 *
 * Each account represents a GitHub user or org that has authorized the STAS app.
 * The plan field determines credit pricing and rate limits for the hosted service.
 */

import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  /** GitHub user ID of the account owner. */
  githubUserId: integer('github_user_id'),
  /** GitHub App installation ID (legacy, kept for backward compat). */
  githubInstallationId: integer('github_installation_id').notNull().unique(),
  /** GitHub App installation ID for the hosted service (multi-tenant). */
  githubAppInstallationId: integer('github_app_installation_id'),
  /** Contact email for the account. */
  email: varchar('email', { length: 255 }),
  /** Display name for the account. */
  name: varchar('name', { length: 255 }),
  /** Billing plan: free, pro, enterprise. */
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  /** Pricing tier (legacy, maps to plan in hosted service). */
  tier: varchar('tier', { length: 50 }).notNull().default('free'),
  /** When the free trial ends (null = no trial or trial expired). */
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
