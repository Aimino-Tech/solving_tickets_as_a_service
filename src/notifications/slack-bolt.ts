// @ts-nocheck
import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { Logger as BoltLogger } from '@slack/bolt';
import type { Express } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { NotificationEvent, NotificationData } from './base.js';

const log = rootLogger.child({ module: 'slack-bolt' });

const ISSUE_URL = (owner: string, repo: string, number: number) =>
  `https://github.com/${owner}/${repo}/issues/${number}`;

function isBoltConfigured(): boolean {
  if (config.slack.botToken && !config.slack.botToken.startsWith('xoxb-')) {
    log.warn('SLACK_BOT_TOKEN does not start with xoxb- — Slack integration disabled');
    return false;
  }
  return !!(config.slack.botToken && config.slack.signingSecret);
}

function buildBlocks(event: NotificationEvent, data: NotificationData): any[] {
  const bot = data.botName ?? config.stas.botName;
  const issueUrl = data.issueNumber > 0
    ? ISSUE_URL(data.repoOwner, data.repoName, data.issueNumber)
    : '';
  const repoUrl = data.repoOwner && data.repoName
    ? `https://github.com/${data.repoOwner}/${data.repoName}`
    : '';

  const headerText = (() => {
    switch (event) {
      case 'fix_started':
        return `${bot} is investigating #${data.issueNumber}`;
      case 'pr_created':
        return `${bot} opened a PR for #${data.issueNumber}`;
      case 'fix_failed':
        return `${bot} couldn't fix #${data.issueNumber}`;
      case 'verification_failed':
        return `${bot} fix for #${data.issueNumber} failed verification`;
      case 'error':
        return `${bot} encountered an error on #${data.issueNumber}`;
      case 'payment_failed':
        return `Payment Failed — ${data.issueTitle}`;
      case 'payment_recovered':
        return `Payment Recovered — ${data.issueTitle}`;
    }
  })();

  const emoji = (() => {
    switch (event) {
      case 'fix_started':
        return 'mag';
      case 'pr_created':
        return 'rocket';
      case 'fix_failed':
        return 'x';
      case 'verification_failed':
        return 'warning';
      case 'error':
        return 'fire';
      case 'payment_failed':
        return 'credit_card';
      case 'payment_recovered':
        return 'white_check_mark';
    }
  })();

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `:${emoji}: ${headerText}`,
        emoji: true,
      },
    },
  ];

  if (event === 'payment_failed' || event === 'payment_recovered') {
    const meta = data.metadata ?? {};
    const fields = [];
    if (data.reason) {
      fields.push({ type: 'mrkdwn', text: `*Reason:*\n${data.reason.slice(0, 300)}` });
    }
    if (meta.amountCents) {
      const amount = `${(Number(meta.amountCents) / 100).toFixed(2)} ${String(meta.currency ?? 'USD').toUpperCase()}`;
      fields.push({ type: 'mrkdwn', text: `*Amount:*\n${amount}` });
    }
    if (data.email) {
      fields.push({ type: 'mrkdwn', text: `*Account:*\n${data.email}` });
    }
    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields,
      });
    }
    // Add a divider
    blocks.push({ type: 'divider' });
  } else if (issueUrl || repoUrl) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${issueUrl}|#${data.issueNumber}: ${data.issueTitle}>*\n<${repoUrl}|${data.repoOwner}/${data.repoName}>`,
      },
    });
  }

  if (event === 'fix_failed' && data.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${data.reason}`,
      },
    });
  }

  if (event === 'error' && data.errorMessage) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Error:* ${data.errorMessage.slice(0, 500)}`,
      },
    });
  }

  if (event === 'verification_failed' && data.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Details:* ${data.reason}`,
      },
    });
  }

  // Action buttons — only add for GitHub-related events
  if (event !== 'payment_failed' && event !== 'payment_recovered') {
    const actionElements: any[] = [];
    if (issueUrl) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'View Issue', emoji: true },
        url: issueUrl,
        action_id: 'view_issue',
      });
    }

    if (event === 'pr_created' && data.prUrl) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'View PR', emoji: true },
        url: data.prUrl,
        action_id: 'view_pr',
      });
    }

    if (actionElements.length > 0) {
      blocks.push({
        type: 'actions',
        elements: actionElements,
      });
    }
  }

  return blocks;
}

export class SlackBoltApp {
  readonly app: App | null = null;
  readonly receiver: ExpressReceiver | null = null;

  constructor() {
    if (!isBoltConfigured()) {
      log.info('Slack Bolt not configured — interactive messages disabled');
      return;
    }

    const boltLogger: BoltLogger = {
      debug: (...msgs: unknown[]) => log.debug(msgs.join(' ')),
      info: (...msgs: unknown[]) => log.info(msgs.join(' ')),
      warn: (...msgs: unknown[]) => log.warn(msgs.join(' ')),
      error: (...msgs: unknown[]) => log.error(msgs.join(' ')),
      setLevel: () => {},
      getLevel: () => LogLevel.INFO,
      setName: () => {},
    };

    this.receiver = new ExpressReceiver({
      signingSecret: config.slack.signingSecret!,
      logger: boltLogger,
      endpoints: {
        events: config.slack.interactionsPath,
      },
      processBeforeResponse: true,
    });

    this.app = new App({
      token: config.slack.botToken,
      receiver: this.receiver,
      logger: boltLogger,
      processBeforeResponse: true,
    });

    this.registerHandlers();
    log.info('Slack Bolt app initialized');
  }

  private registerHandlers(): void {
    if (!this.app) return;

    this.app.action('view_issue', async ({ ack }) => {
      await ack();
    });

    this.app.action('view_pr', async ({ ack }) => {
      await ack();
    });

    this.app.command('/stas', async ({ command, ack, respond, client }) => {
      await ack();

      const text = (command.text || '').trim();
      const channelId = command.channel_id;
      const userId = command.user_id;

      log.info({ text, channelId, userId }, 'Received /stas command');

      if (!text) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: `/stas fix <description>`\nExample: `/stas fix login button not working`',
        });
        return;
      }

      const subcommand = text.split(/\s+/)[0]?.toLowerCase();
      const args = text.slice(subcommand.length).trim();

      if (subcommand === 'fix') {
        const issueTitle = args || 'Fix requested via Slack';
        const repoOwner = config.trackers.defaultRepoOwner;
        const repoName = config.trackers.defaultRepoName;

        if (!repoOwner || !repoName) {
          await respond({
            response_type: 'ephemeral',
            text: 'Error: No default repository configured.',
          });
          return;
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
            issueBody: `Submitted via Slack by <@${userId}>\n\nDescription: ${issueTitle}`,
            source: 'slack',
            slackChannel: channelId,
            slackThreadTs: command.ts,
          };
          const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
          await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
            ...jobData,
            _meta: { messageId, enqueuedAt: new Date().toISOString(), slackChannel: channelId, slackThreadTs: command.ts },
          });

          await respond({
            response_type: 'in_channel',
            text: `STAS is investigating: "${issueTitle}"\nI'll post progress updates in this thread.`,
          });

          if (command.ts) {
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: command.ts,
              text: `:mag: *Phase: Queued* — Run has been queued for "${issueTitle}"`,
            });
          }
        } catch (err) {
          log.error({ err: String(err) }, 'Failed to enqueue Slack fix request');
          await respond({
            response_type: 'ephemeral',
            text: 'Error: Failed to submit fix request.',
          });
        }
      } else if (subcommand === 'status') {
        const runId = args.trim();
        if (!runId) {
          await respond({ response_type: 'ephemeral', text: 'Usage: `/stas status <run_id>`' });
          return;
        }
        try {
          const resp = await fetch(`${config.stas.apiUrl || 'http://localhost:3000'}/mcp/status/${runId}`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!resp.ok) {
            await respond({ response_type: 'ephemeral', text: `Run not found: ${runId}` });
            return;
          }
          const data = await resp.json();
          const statusText = data.status || 'unknown';
          const createdAt = data.createdAt ? new Date(data.createdAt).toISOString() : 'unknown';
          await respond({
            response_type: 'in_channel',
            text: `:bar_chart: *Run Status* — \`${runId}\`\n> Status: *${statusText}*\n> Created: ${createdAt}${data.prUrl ? `\n> PR: ${data.prUrl}` : ''}`,
          });
        } catch (err) {
          log.error({ err: String(err), runId }, 'Failed to check run status');
          await respond({ response_type: 'ephemeral', text: 'Error: Could not fetch run status.' });
        }
      } else if (subcommand === 'help') {
        await respond({
          response_type: 'ephemeral',
          text: [
            '*STAS — Solving Tickets As A Service*',
            '',
            '`/stas fix <description>` — Submit a fix request',
            '`/stas status <run_id>` — Check fix run status',
            '`/stas help` — Show this help message',
            '',
            'Examples:',
            '  `/stas fix login button not working`',
            '  `/stas status stas-a1b2c3d4e5f6`',
          ].join('\n'),
        });
      } else {
        await respond({
          response_type: 'ephemeral',
          text: 'Unknown command. Use `/stas help` to see available commands.',
        });
      }
    });
  }

  mountOn(app: Express): void {
    if (!this.receiver) {
      log.warn('Bolt receiver not available — skipping mount');
      return;
    }
    app.use(this.receiver.router);
    log.info(
      { path: config.slack.interactionsPath },
      'Bolt receiver mounted on Express',
    );
  }

  async sendInteractiveMessage(
    event: NotificationEvent,
    data: NotificationData,
  ): Promise<void> {
    if (!this.app) return;

    const channel = config.slack.channel || '#stas-notifications';
    const blocks = buildBlocks(event, data);

    try {
      await this.app.client.chat.postMessage({
        channel,
        text: `[${event}] ${data.repoOwner}/${data.repoName}#${data.issueNumber}`,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      } as Parameters<typeof this.app.client.chat.postMessage>[0]);
      log.debug(
        { event, channel, repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber },
        'Interactive Slack message sent',
      );
    } catch (err) {
      log.error(
        { err: String(err), event, channel },
        'Failed to send interactive Slack message',
      );
    }
  }
}

let boltAppInstance: SlackBoltApp | null = null;

export function getSlackBoltApp(): SlackBoltApp {
  if (!boltAppInstance) {
    boltAppInstance = new SlackBoltApp();
  }
  return boltAppInstance;
}

export function resetSlackBoltApp(): void {
  boltAppInstance = null;
}
