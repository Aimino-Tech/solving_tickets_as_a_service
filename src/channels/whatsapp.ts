import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from './base.js';
import { formatProgressMessage } from './base.js';

const log = rootLogger.child({ module: 'channel-whatsapp' });

async function sendToN8n(payload: Record<string, unknown>): Promise<boolean> {
  const webhookUrl = config.n8n.whatsappWebhookUrl;
  if (!webhookUrl) {
    log.warn('N8N_WHATSAPP_WEBHOOK_URL not configured');
    return false;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to forward WhatsApp message to n8n');
    return false;
  }
}

export class WhatsAppProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!config.whatsapp.phoneNumberId) {
      log.warn('WhatsApp not configured — skipping progress update');
      return;
    }
    const text = formatProgressMessage(update.phase, update.runId, update.detail, update.prUrl);
    await sendToN8n({
      to: update.channelTarget,
      text,
      preview_url: true,
    });
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!config.whatsapp.phoneNumberId) return;
    await sendToN8n({
      to: msg.channelTarget,
      text: msg.text,
      preview_url: true,
    });
  }
}

export function createWhatsAppProgressSender(): ProgressSender {
  return new WhatsAppProgressSender();
}

export function verifyWhatsAppWebhook(req: { query: Record<string, string | string[] | undefined> }): { challenge?: string; verified: boolean } {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return { challenge: Array.isArray(challenge) ? challenge[0] : challenge, verified: true };
  }
  return { verified: false };
}

export async function handleWhatsAppWebhook(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  const entry = (payload as { entry?: Array<Record<string, unknown>> })?.entry?.[0];
  const change = entry?.changes?.[0] as Record<string, unknown> | undefined;
  const value = change?.value as Record<string, unknown> | undefined;
  const messages = value?.messages as Array<Record<string, unknown>> | undefined;

  if (!messages || messages.length === 0) return { ok: true };

  for (const msg of messages) {
    if (msg.type === 'text' && (msg.text as Record<string, unknown> | undefined)?.body) {
      const from = String(msg.from);
      const text = String((msg.text as Record<string, unknown>).body).trim().toLowerCase();

      if (text.startsWith('fix ')) {
        const issueTitle = text.slice(4).trim() || 'Fix requested via WhatsApp';
        const repoOwner = config.trackers.defaultRepoOwner;
        const repoName = config.trackers.defaultRepoName;

        if (!repoOwner || !repoName) {
          await sendToN8n({ to: from, text: 'Error: No default repository configured.' });
          continue;
        }

        try {
          const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
          if (!isConnected()) {
            await rmqConnect();
          }
          const jobData = {
            installationId: config.trackers.installationId || 0,
            repoOwner,
            repoName,
            repoPrivate: false,
            issueNumber: 0,
            issueTitle,
            issueBody: `Submitted via WhatsApp from ${from}\n\nDescription: ${issueTitle}`,
            source: 'whatsapp',
          };
          const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
          await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
            ...jobData,
            _meta: { messageId, enqueuedAt: new Date().toISOString() },
          });
          await sendToN8n({
            to: from,
            text: `STAS is investigating: "${issueTitle}"\nI'll post progress updates here.`,
          });
        } catch (err) {
          log.error({ err: String(err) }, 'Failed to enqueue WhatsApp fix request');
          await sendToN8n({ to: from, text: 'Error: Failed to submit fix request.' });
        }
      }
    }
  }

  return { ok: true };
}
