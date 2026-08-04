// @ts-nocheck
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from './base.js';
import { formatProgressMessage } from './base.js';

const log = rootLogger.child({ module: 'channel-telegram' });
const TELEGRAM_API_BASE = 'https://api.telegram.org';

function botToken(): string {
  if (!config.telegram.botToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return config.telegram.botToken;
}

async function callTelegram(method: string, body: Record<string, unknown>): Promise<boolean> {
  const token = botToken();
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      log.error({ method, status: response.status, body: text }, 'Telegram API error');
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err: String(err), method }, 'Telegram API call failed');
    return false;
  }
}

function isConfigured(): boolean {
  return !!config.telegram.botToken;
}

export class TelegramProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!isConfigured()) { log.warn('Telegram not configured — skipping progress update'); return; }
    const text = formatProgressMessage(update.phase, update.runId, update.detail, update.prUrl);
    await callTelegram('sendMessage', {
      chat_id: update.channelTarget, text, parse_mode: 'Markdown', disable_web_page_preview: false,
    });
    log.debug({ runId: update.runId, phase: update.phase, chatId: update.channelTarget }, 'Telegram progress sent');
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!isConfigured()) return;
    await callTelegram('sendMessage', {
      chat_id: msg.channelTarget, text: msg.text, parse_mode: 'Markdown', disable_web_page_preview: false,
    });
  }
}

export async function handleTelegramWebhook(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
  if (!isConfigured()) return { ok: false };

  const message = (payload as { message?: Record<string, unknown> })?.message;
  if (!message || !message.text) return { ok: true };

  const chatId = String(message.chat.id);
  const text = String(message.text).trim();
  const entities = message.entities as Array<{ type: string; offset: number; length: number }> | undefined;

  const isBotCommand = entities?.some((e) => e.type === 'bot_command');
  if (!isBotCommand) return { ok: true };

  const parts = text.split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1);

  if (command === '/start') {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Welcome to SYNTARO! Use /fix <description> to submit an issue fix request.',
      parse_mode: 'Markdown',
    });
    return { ok: true };
  }

  if (command === '/fix') {
    const issueTitle = args.join(' ') || 'Fix requested via Telegram';
    const repoOwner = config.trackers.defaultRepoOwner;
    const repoName = config.trackers.defaultRepoName;

    if (!repoOwner || !repoName) {
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Error: No default repository configured.' });
      return { ok: true };
    }

    try {
      const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
      if (!isConnected()) {
        await rmqConnect();
      }
      const jobData = {
        installationId: config.trackers.installationId || 0,
        repoOwner, repoName, repoPrivate: false, issueNumber: 0,
        issueTitle,
        issueBody: `Submitted via Telegram by user ${message.from?.id || 'unknown'}\n\nDescription: ${issueTitle}`,
        source: 'telegram',
      };
      const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        ...jobData,
        _meta: { messageId, enqueuedAt: new Date().toISOString() },
      });
      await callTelegram('sendMessage', {
        chat_id: chatId, text: `SYNTARO is investigating: "${issueTitle}"\n\nI'll post progress updates here.`,
      });
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to enqueue Telegram fix request');
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Error: Failed to submit fix request.' });
    }
    return { ok: true };
  }

  return { ok: true };
}

export function createTelegramProgressSender(): ProgressSender {
  return new TelegramProgressSender();
}
