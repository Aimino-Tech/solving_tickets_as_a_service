/**
 * Webhook events types — records all incoming webhooks for replay/debugging.
 */

export interface WebhookEvent {
  id: number;
  source: string;
  eventType: string;
  deliveryId: string | null;
  installationId: string | null;
  repo: string | null;
  payload: unknown | null;
  rawBodySnippet: string | null;
  headers: unknown | null;
  status: string;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface NewWebhookEvent {
  id?: number;
  source: string;
  eventType: string;
  deliveryId?: string | null;
  installationId?: string | null;
  repo?: string | null;
  payload?: unknown | null;
  rawBodySnippet?: string | null;
  headers?: unknown | null;
  status?: string;
  retryCount?: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  createdAt?: Date;
  processedAt?: Date | null;
}
