/**
 * Audit logs schema — append-only log of all security-relevant and system events.
 *
 * This table captures every significant event in the system:
 * - Webhook received and processed
 * - Fix job lifecycle (created, started, completed, failed)
 * - PR created
 * - Credit transactions (purchases, usage, adjustments)
 * - Account tier changes
 * - Admin actions
 * - Rate limit hits
 *
 * IMPORTANT: No DELETE or UPDATE operations are permitted on this table.
 * Only INSERT (for logging) and SELECT (for querying) are allowed.
 */

import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  actorType: varchar('actor_type', { length: 20 }).notNull().default('system'),
  actorId: varchar('actor_id', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: varchar('resource_id', { length: 255 }),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  correlationId: varchar('correlation_id', { length: 255 }),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
