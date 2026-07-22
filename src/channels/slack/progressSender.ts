import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import { getSlackBoltApp } from '../../notifications/slack-bolt.js';
import type { ProgressUpdate, ChannelMessage, ProgressSender } from '../base.js';

const log = rootLogger.child({ module: 'channel-slack' });

function isConfigured(): boolean {
  if (config.slack.botToken && !config.slack.botToken.startsWith('xoxb-')) {
    log.warn('SLACK_BOT_TOKEN does not start with xoxb- — Slack integration disabled');
    return false;
  }
  return !!(config.slack.botToken && config.slack.signingSecret);
}

export class SlackProgressSender implements ProgressSender {
  async sendProgress(update: ProgressUpdate): Promise<void> {
    if (!isConfigured()) {
      log.warn('Slack not configured — skipping progress update');
      return;
    }

    const bolt = getSlackBoltApp();
    if (!bolt.app) {
      log.warn('Slack Bolt app not initialized — skipping progress update');
      return;
    }

    const client = bolt.app.client;
    const [channelId, threadTs] = parseChannelTarget(update.channelTarget);
    const blocks = buildProgressBlocks(update);

    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `${update.phase}: ${update.message}`,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      } as any);
      log.debug({ runId: update.runId, phase: update.phase, channelId }, 'Slack progress sent');
    } catch (err) {
      log.error({ err: String(err), runId: update.runId, phase: update.phase }, 'Failed to send Slack progress');
    }
  }

  async sendMessage(msg: ChannelMessage): Promise<void> {
    if (!isConfigured()) return;

    const bolt = getSlackBoltApp();
    if (!bolt.app) return;

    const client = bolt.app.client;
    const [channelId, threadTs] = parseChannelTarget(msg.channelTarget);

    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: msg.text,
      } as any);
    } catch (err) {
      log.error({ err: String(err) }, 'Failed to send Slack message');
    }
  }
}

function parseChannelTarget(target: string): [string, string | undefined] {
  if (target.includes(':')) {
    const colonIdx = target.indexOf(':');
    return [target.slice(0, colonIdx), target.slice(colonIdx + 1)];
  }
  return [target, undefined];
}

function buildProgressBlocks(update: ProgressUpdate): any[] {
  const emoji: Record<string, string> = {
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

  const phaseLabels: Record<string, string> = {
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
        text: `${emoji[update.phase] ?? ':question:'} *${phaseLabels[update.phase] ?? update.phase}* — Run \`${update.runId}\``,
      },
    },
  ];

  if (update.message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: update.detail
          ? `> ${update.message}\n> \`${update.detail.slice(0, 500)}\``
          : `> ${update.message}`,
      },
    });
  }

  if (update.prUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View PR', emoji: true },
          url: update.prUrl,
          action_id: 'view_pr',
          style: 'primary',
        },
      ],
    });
  }

  if (update.phase === 'failed' || update.phase === 'error') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Retry', emoji: true },
          action_id: 'retry_run',
          value: update.runId,
        },
      ],
    });
  }

  return blocks;
}

export function createSlackProgressSender(): ProgressSender {
  return new SlackProgressSender();
}
