/**
 * Audit logs schema — append-only log of security-relevant events.
 *
 * Records actions like login, config change, API key creation, etc.
 * Never delete or update rows in this table.
 *
 * Extended fields for multi-tenant:
 *   - actor: who performed the action (user email, system, api key name)
 *   - target: what was acted upon (resource identifier)
 */

import { inet, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  /** Who performed the action (email, system name, API key label). */
  actor: varchar('actor', { length: 255 }),
  /** The action performed (e.g. "account.created", "run.started", "billing.updated"). */
  action: varchar('action', { length: 100 }).notNull(),
  /** What resource was acted upon (e.g. "run:42", "repo:owner/name"). */
  target: varchar('target', { length: 255 }),
  /** Free-form details or metadata about the event. */
  details: text('details'),
  /** IP address of the actor (if applicable). */
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
