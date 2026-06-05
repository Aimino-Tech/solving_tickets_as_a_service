/**
 * Webhook events schema — records all incoming webhooks for replay/debugging.
 *
 * Stores raw payloads from GitHub, GitLab, Bitbucket, Stripe, etc.
 * Tracks delivery status, retry count, and processing timestamps.
 * Supports idempotency via unique (delivery_id, source) index.
 * Retry scheduling via next_retry_at for exponential backoff.
 */

import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable('webhook_events', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  deliveryId: varchar('delivery_id', { length: 255 }),
  installationId: varchar('installation_id', { length: 255 }),
  repo: varchar('repo', { length: 255 }),
  payload: jsonb('payload'),
  rawBodySnippet: text('raw_body_snippet'),
  headers: jsonb('headers'),
  status: varchar('status', { length: 20 }).notNull().default('received'),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
