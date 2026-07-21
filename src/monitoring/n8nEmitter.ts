import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'n8n-emitter' });

export interface N8nAlertPayload {
  severity: string;
  rule: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export async function emitN8nAlert(payload: N8nAlertPayload): Promise<void> {
  const webhookUrl = config.alerting.n8nWebhookUrl;
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.warn(
        { status: response.status, rule: payload.rule },
        'n8n webhook returned non-200',
      );
    }
  } catch (err) {
    log.warn({ err: String(err), rule: payload.rule }, 'Failed to send alert to n8n');
  }
}
