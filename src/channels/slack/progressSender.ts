import { config } from '../../config.js';
import { getSlackBoltApp } from '../../notifications/slack-bolt.js';
import { rootLogger } from '../../utils/logger.js';
import type { ChannelMessage, ProgressPhase, ProgressSender, ProgressUpdate } from '../base.js';
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

function buildProgressBlocks(update: ProgressUpdate): any[] {
  const phaseEmoji: Record<ProgressPhase, string> = {
    queued: ':hourglass_flowing_sand:',
    investigating: ':mag:',
    fixing: ':hammer:',
    testing: ':test_tube:',
    verifying: ':white_check_mark:',
    committing: ':inbox_tray:',
    pr_created: ':rocket:',
    failed: ':x:',
    error: ':fire:',
  };

  const phaseLabels: Record<ProgressPhase, string> = {
    queued: 'Queued',
    investigating: 'Investigating',
    fixing: 'Fixing',
    testing: 'Testing',
    verifying: 'Verifying',
    committing: 'Committing',
    pr_created: 'PR Created',
    failed: 'Failed',
    error: 'Error',
  };

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${phaseEmoji[update.phase] || ':sparkles:'} *${phaseLabels[update.phase] || update.phase}* — Run \`${update.runId}\``,
      },
    },
  ];

  if (update.message) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: update.message },
    });
  }

  if (update.detail) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `> ${update.detail}` },
    });
  }

  if (update.prUrl) {
    const actionElements: any[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View PR', emoji: true },
        url: update.prUrl,
        action_id: 'view_pr',
      },
    ];
    blocks.push({
      type: 'actions',
      elements: actionElements,
    });
  }

  if (update.phase === 'failed' || update.phase === 'error') {
    const retryElements: any[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Retry', emoji: true },
        action_id: 'retry_run',
        value: update.runId,
      },
    ];
    blocks.push({
      type: 'actions',
      elements: retryElements,
    });
  }

  if (update.progress !== undefined) {
    const barLen = 10;
    const filled = Math.round((update.progress / 100) * barLen);
    const empty = barLen - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${bar} ${update.progress}%` }],
    });
  }

  return blocks;
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
    const blocks = buildProgressBlocks(update);

    try {
      await bolt.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      });
      log.debug(
        { runId: update.runId, phase: update.phase, channel, hasThread: !!threadTs },
        'Slack progress update sent',
      );
    } catch (err) {
      log.error(
        { err: String(err), runId: update.runId, phase: update.phase, channel },
        'Failed to send Slack progress update',
      );
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
