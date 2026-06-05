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

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  actorType: varchar('actor_type', { length: 20 }).notNull().default('system'), // system | admin | user | webhook
  actorId: varchar('actor_id', { length: 255 }), // account_id (user), admin key hash, webhook delivery id, etc.
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }), // account | issue | pr | credit | webhook | system
  resourceId: varchar('resource_id', { length: 255 }),
  details: jsonb('details'), // Arbitrary JSON metadata about the event
  ipAddress: varchar('ip_address', { length: 45 }), // IPv4 or IPv6
  userAgent: text('user_agent'),
  correlationId: varchar('correlation_id', { length: 255 }), // request_id or job_id for tracing
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
