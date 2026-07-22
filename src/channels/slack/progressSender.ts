import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import { getSlackBoltApp } from '../../notifications/slack-bolt.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from '../base.js';
import { formatProgressMessage } from '../base.js';

const log = rootLogger.child({ module: 'channel-slack-progress' });

function parseChannelTarget(target: string): { channel: string; threadTs?: string } {
  const colonIdx = target.indexOf(':');
  if (colonIdx > 0) {
    return { channel: target.slice(0, colonIdx), threadTs: target.slice(colonIdx + 1) };
  }
  return { channel: target };
}

function isConfigured(): boolean {
  return !!(config.slack.botToken && config.slack.signingSecret);
}

export class SlackProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!isConfigured()) {
      log.warn('Slack not configured — skipping progress update');
      return;
    }

    const bolt = getSlackBoltApp().app;
    if (!bolt) {
      log.warn('Slack Bolt app not initialized — skipping progress update');
      return;
    }

    const { channel, threadTs } = parseChannelTarget(update.channelTarget);
    const text = formatProgressMessage(update.phase, update.runId, update.detail, update.prUrl);

    try {
      await bolt.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      log.debug(
        { runId: update.runId, phase: update.phase, channel, hasThread: !!threadTs },
        'Slack progress update sent',
      );
    } catch (err) {
      log.error({ err: String(err), runId: update.runId, phase: update.phase, channel }, 'Failed to send Slack progress update');
    }
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!isConfigured()) return;

    const bolt = getSlackBoltApp().app;
    if (!bolt) return;

    const { channel, threadTs } = parseChannelTarget(msg.channelTarget);

    try {
      await bolt.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: msg.text,
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (err) {
      log.error({ err: String(err), channel }, 'Failed to send Slack message');
    }
  }
}

export function createSlackProgressSender(): ProgressSender {
  return new SlackProgressSender();
}
