import { PostHog } from 'posthog-node';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'analytics' });

let client: PostHog | null = null;

export function initAnalytics(): void {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    log.warn('POSTHOG_API_KEY not set — analytics disabled');
    return;
  }
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  });
  log.info('Analytics initialized');
}

export function captureEvent(event: string, distinctId: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: { ...properties, source: 'syntaro' },
    });
  } catch (err) {
    log.error({ err: String(err), event }, 'Failed to capture analytics event');
  }
}

export async function shutdownAnalytics(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
