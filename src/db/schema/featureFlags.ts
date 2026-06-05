/**
 * Feature flags schema — per-account feature toggles.
 *
 * Allows gradual rollout of features to specific accounts.
 */

import { boolean, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const featureFlags = pgTable('feature_flags', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  flag: varchar('flag', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
