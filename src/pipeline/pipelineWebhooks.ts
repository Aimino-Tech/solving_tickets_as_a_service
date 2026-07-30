import { createHmac, randomUUID } from 'node:crypto';
import { rootLogger } from '../utils/logger.js';
import type { SessionState, WebhookConfig, WebhookDelivery } from './types.js';

const log = rootLogger.child({ module: 'pipeline-webhooks' });

const registeredWebhooks: Map<string, WebhookConfig> = new Map();
const deliveryStore: WebhookDelivery[] = [];
const MAX_DELIVERIES = 1000;

const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;

function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function registerWebhook(id: string, config: WebhookConfig): void {
  registeredWebhooks.set(id, {
    ...config,
    retryCount: config.retryCount ?? DEFAULT_RETRY_COUNT,
    retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  });
  log.info({ webhookId: id, url: config.url, events: config.events }, 'Webhook registered');
}

export function unregisterWebhook(id: string): boolean {
  return registeredWebhooks.delete(id);
}

export function listWebhooks(): Array<{ id: string; config: WebhookConfig }> {
  return [...registeredWebhooks.entries()].map(([id, config]) => ({ id, config }));
}

function recordDelivery(delivery: WebhookDelivery): void {
  deliveryStore.push(delivery);
  if (deliveryStore.length > MAX_DELIVERIES) {
    deliveryStore.splice(0, deliveryStore.length - MAX_DELIVERIES);
  }
}

export function getDeliveries(limit: number = 50): WebhookDelivery[] {
  return deliveryStore.slice(-limit).reverse();
}

async function deliverWebhook(config: WebhookConfig, event: string, payload: unknown): Promise<WebhookDelivery> {
  const id = randomUUID();
  const delivery: WebhookDelivery = {
    id,
    event,
    url: config.url,
    status: 'pending',
    payload,
    attemptedAt: new Date().toISOString(),
    retryCount: 0,
  };

  const body = JSON.stringify({
    event,
    id,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Pipeline-Event': event,
    'X-Delivery-ID': id,
    ...config.headers,
  };

  if (config.secret) {
    headers['X-Pipeline-Signature'] = computeSignature(body, config.secret);
  }

  let lastError: string | undefined;
  const maxRetries = config.retryCount ?? DEFAULT_RETRY_COUNT;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      delivery.responseStatus = response.status;
      delivery.retryCount = attempt;

      if (response.ok) {
        delivery.status = 'delivered';
        delivery.deliveredAt = new Date().toISOString();
        recordDelivery(delivery);
        return delivery;
      }

      lastError = `HTTP ${response.status}: ${await response.text().catch(() => 'unknown')}`;
      log.warn(
        { webhookUrl: config.url, event, attempt, status: response.status },
        'Webhook delivery failed, will retry',
      );
    } catch (err) {
      lastError = String(err);
      log.warn({ webhookUrl: config.url, event, attempt, error: lastError }, 'Webhook delivery error, will retry');
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    }
  }

  delivery.status = 'failed';
  delivery.error = lastError;
  recordDelivery(delivery);
  log.error({ webhookUrl: config.url, event, error: lastError }, 'Webhook delivery failed after all retries');
  return delivery;
}

export async function dispatchPipelineEvent(
  event: string,
  session: SessionState,
  extraData?: Record<string, unknown>,
): Promise<void> {
  const payload = {
    sessionId: session.sessionId,
    issueId: session.issueId,
    pipelineName: session.pipelineName,
    status: session.status,
    currentStage: session.currentStage,
    progress: session.progress,
    attempt: session.attempt,
    error: session.error,
    ...extraData,
  };

  const matchedWebhooks = [...registeredWebhooks.values()].filter(
    (w) => w.events.includes('*') || w.events.includes(event),
  );

  if (matchedWebhooks.length === 0) return;

  const deliveries = matchedWebhooks.map((w) => deliverWebhook(w, event, payload));
  const results = await Promise.allSettled(deliveries);

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    log.warn({ event, total: matchedWebhooks.length, failed }, 'Some webhook deliveries failed');
  }
}

export function getStoredDeliveries(): WebhookDelivery[] {
  return [...deliveryStore];
}

export function clearDeliveries(): void {
  deliveryStore.length = 0;
}
