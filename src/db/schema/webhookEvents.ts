/**
 * Webhook events schema — records all incoming webhooks for replay/debugging.
 *
 * Stores raw payloads from GitHub, GitLab, Bitbucket, Stripe, etc.
 * The `processed` flag tracks whether the event has been handled.
 */

import { pgTable, serial, varchar, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable('webhook_events', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 50 }).notNull(), // github | gitlab | bitbucket | stripe | slack | linear | jira
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload'),
  processed: boolean('processed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
