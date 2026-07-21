import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from './base.js';
import { formatProgressMessage } from './base.js';

const log = rootLogger.child({ module: 'channel-telegram' });

async function sendToN8n(payload: Record<string, unknown>): Promise<boolean> {
  const webhookUrl = config.n8n.telegramWebhookUrl;
  if (!webhookUrl) {
    log.warn('N8N_TELEGRAM_WEBHOOK_URL not configured');
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
    log.error({ err: String(err) }, 'Failed to forward Telegram message to n8n');
    return false;
  }
}

export class TelegramProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!config.telegram.botToken) {
      log.warn('Telegram not configured — skipping progress update');
      return;
    }
    const text = formatProgressMessage(update.phase, update.runId, update.detail, update.prUrl);
    await sendToN8n({
      chat_id: update.channelTarget,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!config.telegram.botToken) return;
    await sendToN8n({
      chat_id: msg.channelTarget,
      text: msg.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  }
}

export async function handleTelegramWebhook(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  const message = (payload as { message?: Record<string, unknown> })?.message;
  if (!message || !message.text) return { ok: true };

  const chatId = String(message.chat.id);
  const text = String(message.text).trim();
  const entities = message.entities as Array<{ type: string; offset: number; length: number }> | undefined;

  const isBotCommand = entities?.some((e) => e.type === 'bot_command');
  if (!isBotCommand) return { ok: true };

  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';

  if (command === '/start') {
    await sendToN8n({
      chat_id: chatId,
      text: 'Welcome to STAS! Use /fix <description> to submit an issue fix request.',
      parse_mode: 'Markdown',
    });
    return { ok: true };
  }

  if (command === '/fix') {
    const issueTitle = parts.slice(1).join(' ') || 'Fix requested via Telegram';
    const repoOwner = config.trackers.defaultRepoOwner;
    const repoName = config.trackers.defaultRepoName;

    if (!repoOwner || !repoName) {
      await sendToN8n({ chat_id: chatId, text: 'Error: No default repository configured.' });
      return { ok: true };
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
        issueBody: `Submitted via Telegram by user ${(message.from as Record<string, unknown> | undefined)?.id || 'unknown'}\n\nDescription: ${issueTitle}`,
        source: 'telegram',
      };
      const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        ...jobData,
        _meta: { messageId, enqueuedAt: new Date().toISOString() },
      });
      await sendToN8n({
        chat_id: chatId,
        text: `STAS is investigating: "${issueTitle}"\n\nI'll post progress updates here.`,
      });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to enqueue Telegram fix request');
      await sendToN8n({ chat_id: chatId, text: 'Error: Failed to submit fix request.' });
    }
    return { ok: true };
  }

  return { ok: true };
}

export function createTelegramProgressSender(): ProgressSender {
  return new TelegramProgressSender();
}
