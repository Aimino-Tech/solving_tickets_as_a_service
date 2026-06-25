import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from './base.js';
import { formatProgressMessage } from './base.js';

const log = rootLogger.child({ module: 'channel-whatsapp' });
const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

function phoneNumberId(): string {
  if (!config.whatsapp.phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID not configured');
  return config.whatsapp.phoneNumberId;
}

function accessToken(): string {
  if (!config.whatsapp.accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not configured');
  return config.whatsapp.accessToken;
}

async function callWhatsApp(body: Record<string, unknown>): Promise<boolean> {
  const id = phoneNumberId();
  const token = accessToken();
  try {
    const response = await fetch(`${GRAPH_API_BASE}/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, 'WhatsApp API error');
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err: String(err) }, 'WhatsApp API call failed');
    return false;
  }
}

function isConfigured(): boolean {
  return !!(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
}

export class WhatsAppProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!isConfigured()) { log.warn('WhatsApp not configured — skipping progress update'); return; }
    const text = formatProgressMessage(update.phase, update.runId, update.detail, update.prUrl);
    await callWhatsApp({
      messaging_product: 'whatsapp', to: update.channelTarget, type: 'text',
      text: { preview_url: true, body: text },
    });
    log.debug({ runId: update.runId, phase: update.phase, to: update.channelTarget }, 'WhatsApp progress sent');
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!isConfigured()) return;
    await callWhatsApp({
      messaging_product: 'whatsapp', to: msg.channelTarget, type: 'text',
      text: { preview_url: true, body: msg.text },
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
  if (!isConfigured()) return { ok: false };

  const entry = (payload as any).entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages = value?.messages;

  if (!messages || !Array.isArray(messages) || messages.length === 0) return { ok: true };

  for (const msg of messages) {
    if (msg.type === 'text' && msg.text?.body) {
      const from = String(msg.from);
      const text = String(msg.text.body).trim().toLowerCase();

      if (text.startsWith('fix ')) {
        const issueTitle = text.slice(4).trim() || 'Fix requested via WhatsApp';
        const repoOwner = config.trackers.defaultRepoOwner;
        const repoName = config.trackers.defaultRepoName;

        if (!repoOwner || !repoName) {
          await callWhatsApp({
            messaging_product: 'whatsapp', to: from, type: 'text',
            text: { body: 'Error: No default repository configured.' },
          });
          continue;
        }

        try {
          const { enqueueIssue } = await import('../queue/issueQueue.js');
          await enqueueIssue(undefined, {
            installationId: config.trackers.installationId || 0,
            repoOwner, repoName, repoPrivate: false, issueNumber: 0,
            issueTitle,
            issueBody: `Submitted via WhatsApp from ${from}\n\nDescription: ${issueTitle}`,
            source: 'whatsapp',
          });
          await callWhatsApp({
            messaging_product: 'whatsapp', to: from, type: 'text',
            text: { body: `STAS is investigating: "${issueTitle}"\nI'll post progress updates here.` },
          });
        } catch (err) {
          log.error({ err: String(err) }, 'Failed to enqueue WhatsApp fix request');
          await callWhatsApp({
            messaging_product: 'whatsapp', to: from, type: 'text',
            text: { body: 'Error: Failed to submit fix request.' },
          });
        }
      }
    }
  }

  return { ok: true };
}
