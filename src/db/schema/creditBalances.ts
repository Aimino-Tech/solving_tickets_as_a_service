/**
 * Credit balances schema — tracks current balance and lifetime credits per account.
 *
 * One row per account, updated atomically on each transaction.
 */

import { integer, pgTable, serial, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const creditBalances = pgTable('credit_balances', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' })
    .unique(),
  balance: integer('balance').notNull().default(0),
  lifetimeCredits: integer('lifetime_credits').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CreditBalance = typeof creditBalances.$inferSelect;
export type NewCreditBalance = typeof creditBalances.$inferInsert;
