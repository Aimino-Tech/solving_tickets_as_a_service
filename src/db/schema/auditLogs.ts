/**
 * Audit logs schema — append-only log of security-relevant events.
 *
 * Records actions like login, config change, API key creation, etc.
 * Never delete or update rows in this table.
 */

import { pgTable, serial, integer, varchar, text, inet, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 100 }).notNull(),
  details: text('details'),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
