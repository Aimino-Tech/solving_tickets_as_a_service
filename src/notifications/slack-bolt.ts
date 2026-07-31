// @ts-nocheck

import type { Logger as BoltLogger } from '@slack/bolt';
import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { Express } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { NotificationData, NotificationEvent } from './base.js';

const log = rootLogger.child({ module: 'slack-bolt' });

const ISSUE_URL = (owner: string, repo: string, number: number) =>
  `https://github.com/${owner}/${repo}/issues/${number}`;

function isBoltConfigured(): boolean {
  if (!config.slack.ticketEnabled) {
    log.info('SLACK_TICKET_ENABLED is false — Slack bolt features disabled');
    return false;
  }
  if (config.slack.botToken && !config.slack.botToken.startsWith('xoxb-')) {
    log.warn('SLACK_BOT_TOKEN does not start with xoxb- — Slack integration disabled');
    return false;
  }
  if (config.slack.appToken) {
    return !!config.slack.botToken;
  }
  return !!(config.slack.botToken && config.slack.signingSecret);
}

function buildBlocks(event: NotificationEvent, data: NotificationData): any[] {
  const bot = data.botName ?? config.stas.botName;
  const issueUrl = data.issueNumber > 0 ? ISSUE_URL(data.repoOwner, data.repoName, data.issueNumber) : '';
  const repoUrl = data.repoOwner && data.repoName ? `https://github.com/${data.repoOwner}/${data.repoName}` : '';

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

    const appToken = config.slack.appToken;
    if (appToken) {
      this.receiver = null;
      this.app = new App({
        token: config.slack.botToken,
        appToken,
        socketMode: true,
        logger: boltLogger,
      });
      log.info('Slack Bolt app initialized in Socket Mode');
    } else {
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
      log.info('Slack Bolt app initialized');
    }

    this.registerHandlers();
  }

  private registerHandlers(): void {
    if (!this.app) return;

    this.app.action('view_issue', async ({ ack }) => {
      await ack();
    });

    this.app.action('view_pr', async ({ ack }) => {
      await ack();
    });

    const stasCommandHandler = async ({ command, ack, respond, client }: any) => {
      await ack();

      const text = (command.text || '').trim();
      const channelId = command.channel_id;
      const userId = command.user_id;
      const threadTs = command.ts;

      log.info({ text, channelId, userId }, 'Received /stas command');

      if (!text) {
        await respond({
          response_type: 'ephemeral',
          text:
            'Usage: `/stas fix <description>` or `/stas fix owner/repo <description>` or `/stas status <run_id>`\n' +
            'Example: `/stas fix login button not working`\n' +
            'Type `/stas help` for all commands.',
        });
        return;
      }

      if (text === 'help') {
        await respond({
          response_type: 'ephemeral',
          text:
            '*STAS Slack Commands:*\n\n' +
            '• `/stas fix <description>` — Submit a fix request with the default repo\n' +
            '• `/stas fix owner/repo <description>` — Submit a fix for a specific repo\n' +
            '• `/stas status <run_id>` — Check the status of a running fix\n' +
            '• `/stas help` — Show this message\n\n' +
            '_Progress updates appear as thread replies to your command._',
        });
        return;
      }

      if (text.startsWith('status ')) {
        const runId = text.slice(7).trim();
        if (!runId) {
          await respond({ response_type: 'ephemeral', text: 'Usage: `/stas status <run_id>`' });
          return;
        }

        try {
          const { Redis } = await import('ioredis');
          const redis = new Redis(config.queue.redisUrl, {
            keyPrefix: 'mcp:',
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
          });
          await redis.connect();
          const raw = await redis.get(`job:${runId}`);
          await redis.quit().catch(() => {});

          if (!raw) {
            await respond({ response_type: 'in_channel', text: `Run \`${runId}\` not found.` });
            return;
          }

          const job = JSON.parse(raw);
          const statusEmoji: Record<string, string> = {
            queued: ':hourglass_flowing_sand:',
            investigating: ':mag:',
            fixing: ':hammer:',
            testing: ':test_tube:',
            verifying: ':white_check_mark:',
            committing: ':inbox_tray:',
            completed: ':rocket:',
            failed: ':x:',
            error: ':fire:',
          };
          const emoji = statusEmoji[job.status] || ':grey_question:';
          const statusLine = `${emoji} *Status:* ${job.status}`;
          const messageLine = job.message ? `\n> ${job.message}` : '';
          const prLine = job.prUrl ? `\n> PR: ${job.prUrl}` : '';

          await respond({
            response_type: 'in_channel',
            text: `*Run \`${runId}\`*\n${statusLine}${messageLine}${prLine}`,
          });

          if (threadTs) {
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `*Run \`${runId}\`*\n${statusLine}${messageLine}${prLine}`,
            });
          }
        } catch (err) {
          log.error({ err: String(err), runId }, 'Failed to check status');
          await respond({
            response_type: 'ephemeral',
            text: `Error checking status for \`${runId}\`: ${String(err).slice(0, 200)}`,
          });
        }
        return;
      }

      if (text.startsWith('fix ')) {
        const args = text.slice(4).trim();
        let issueTitle: string;
        let repoOwner: string | undefined;
        let repoName: string | undefined;

        const repoPattern = /^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\s+(.+)$/;
        const repoMatch = args.match(repoPattern);
        if (repoMatch) {
          repoOwner = repoMatch[1];
          repoName = repoMatch[2];
          issueTitle = repoMatch[3];
        } else {
          issueTitle = args || 'Fix requested via Slack';
          repoOwner = config.trackers.defaultRepoOwner;
          repoName = config.trackers.defaultRepoName;
        }

        if (!repoOwner || !repoName) {
          await respond({
            response_type: 'ephemeral',
            text: 'Error: No repository specified and no default repository configured.\nUse: `/stas fix owner/repo <description>`',
          });
          return;
        }

        const channelTarget = `${channelId}:${threadTs || ''}`;
        const jobData = {
          installationId: config.trackers.installationId || 0,
          repoOwner,
          repoName,
          repoPrivate: false,
          issueNumber: 0,
          issueTitle,
          issueBody: `Submitted via Slack by <@${userId}>\n\nDescription: ${issueTitle}`,
          source: 'slack',
          channel: 'slack',
          channelTarget,
        };

        let dispatchSuccess = false;

        try {
          const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
          if (!isConnected()) {
            await rmqConnect();
            if (!isConnected()) {
              throw new Error('Failed to establish RabbitMQ connection');
            }
          }
          const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
          await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
            ...jobData,
            _meta: {
              messageId,
              enqueuedAt: new Date().toISOString(),
              slackChannel: channelId,
              slackThreadTs: threadTs || '',
            },
          });
          dispatchSuccess = true;
        } catch (rmqErr) {
          log.warn({ err: String(rmqErr) }, 'RabbitMQ dispatch failed, trying HTTP fallback');
        }

        if (!dispatchSuccess) {
          try {
            const { dispatchToOpenSymphony } = await import('../dispatch/osDispatch.js');
            const result = await dispatchToOpenSymphony(jobData);
            if (!result.success) {
              throw new Error(result.errors?.join(', ') || 'HTTP dispatch failed');
            }
            log.info({ runId: result.runId }, 'HTTP fallback dispatch succeeded');
            dispatchSuccess = true;
          } catch (httpErr) {
            log.error({ err: String(httpErr) }, 'All dispatch paths failed');
            await respond({
              response_type: 'ephemeral',
              text: `Error: ${String(httpErr).slice(0, 200)}`,
            });
            return;
          }
        }

        await respond({
          response_type: 'in_channel',
          text: `STAS is investigating: "${issueTitle}"\nI'll post progress updates in this thread.`,
        });

        if (threadTs) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:mag: *Phase: Investigating* — Run queued for "${issueTitle}"`,
          });
        }
        return;
      }

      await respond({
        response_type: 'ephemeral',
        text: `Unknown command: \`${text}\`. Try \`/stas help\` or \`/stas fix <description>\`.`,
      });
    };

    this.app.command('/stas', stasCommandHandler);
    this.app.command('/STAS', stasCommandHandler);

    this.app.command('/stas-ticket', async ({ command, ack, client }) => {
      await ack();

      log.info({ channelId: command.channel_id, userId: command.user_id }, 'Received /stas-ticket command');

      try {
        await client.views.open({
          trigger_id: command.trigger_id,
          view: {
            type: 'modal',
            callback_id: 'stas_ticket_modal',
            title: { type: 'plain_text', text: 'Create Linear Ticket' },
            submit: { type: 'plain_text', text: 'Create' },
            close: { type: 'plain_text', text: 'Cancel' },
            blocks: [
              {
                type: 'input',
                block_id: 'title_block',
                label: { type: 'plain_text', text: 'Title' },
                element: {
                  type: 'plain_text_input',
                  action_id: 'title',
                  placeholder: { type: 'plain_text', text: 'Brief description of the issue' },
                },
              },
              {
                type: 'input',
                block_id: 'description_block',
                label: { type: 'plain_text', text: 'Description' },
                element: {
                  type: 'plain_text_input',
                  action_id: 'description',
                  multiline: true,
                  placeholder: { type: 'plain_text', text: 'Detailed description of the issue' },
                },
              },
              {
                type: 'input',
                block_id: 'priority_block',
                label: { type: 'plain_text', text: 'Priority' },
                element: {
                  type: 'static_select',
                  action_id: 'priority',
                  initial_option: { value: '2', text: { type: 'plain_text', text: 'High' } },
                  options: [
                    { value: '1', text: { type: 'plain_text', text: ':fire: Urgent' } },
                    { value: '2', text: { type: 'plain_text', text: ':warning: High' } },
                    { value: '3', text: { type: 'plain_text', text: ':book: Medium' } },
                    { value: '4', text: { type: 'plain_text', text: ':beetle: Low' } },
                  ],
                },
              },
            ],
          },
        });
      } catch (err) {
        log.error({ err: String(err) }, 'Failed to open /stas-ticket modal');
      }
    });

    this.app.view('stas_ticket_modal', async ({ ack, body, view, client }) => {
      await ack();

      const values = view.state.values;
      const title = values.title_block?.title?.value ?? '';
      const description = values.description_block?.description?.value ?? '';
      const priority = Number(values.priority_block?.priority?.value ?? 2);

      if (!title) {
        log.warn('stas_ticket_modal submitted with empty title');
        return;
      }

      const channelId = body.channel?.id ?? body.user.id;
      const userId = body.user.id;

      try {
        const { getTracker } = await import('../trackers/index.js');
        const tracker = getTracker('linear');

        if (!tracker) {
          await client.chat.postMessage({
            channel: channelId,
            text: `:x: Linear tracker not configured. Please set \`LINEAR_API_KEY\`.`,
          });
          return;
        }

        const ticket = await tracker.createTicket({
          teamId: 'AIM',
          title,
          description,
          priority,
        });

        await client.chat.postMessage({
          channel: channelId,
          text: `:white_check_mark: *Linear ticket created by <@${userId}>*\n*${ticket.title}*\n${ticket.url}`,
        });

        log.info({ ticketId: ticket.id, title }, 'Ticket created via /stas-ticket');
      } catch (err) {
        log.error({ err: String(err), title }, 'Failed to create ticket via /stas-ticket');
        try {
          await client.chat.postMessage({
            channel: channelId,
            text: `:x: Failed to create ticket: ${String(err).slice(0, 500)}`,
          });
        } catch {
          /* ignore */
        }
      }
    });

    this.app.message(async ({ message, say, client }) => {
      const msg = message as any;
      if (msg.subtype === 'bot_message' || msg.channel_type !== 'im') return;
      const text = (msg.text || '').trim();
      if (!text) return;

      // When the chat bridge is enabled, DMs are handled by the chat gateway
      // (AIM-4442) instead of being treated as one-shot fix requests.
      if (config.slack.chatEnabled) return;

      log.info({ text, userId: msg.user, channel: msg.channel }, 'Received DM to STAS');

      await say(`:mag: *Investigating:* "${text}"\nProcessing your request...`);

      const repoOwner = config.trackers.defaultRepoOwner;
      const repoName = config.trackers.defaultRepoName;

      if (!repoOwner || !repoName) {
        await say('Error: No default repository configured. Use `/stas fix owner/repo <description>` in a channel.');
        return;
      }

      try {
        const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
        if (!isConnected()) {
          await rmqConnect().catch(() => {});
        }
        if (!isConnected()) {
          await say('Error: Message queue not available. Please try again later.');
          return;
        }
        const jobData = {
          installationId: config.trackers.installationId || 0,
          repoOwner,
          repoName,
          repoPrivate: false,
          issueNumber: 0,
          issueTitle: text,
          issueBody: `Submitted via Slack DM by <@${msg.user}>\n\nDescription: ${text}`,
          source: 'slack' as const,
          channel: 'slack',
          channelTarget: `${msg.channel}:${msg.ts || ''}`,
        };
        const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
        await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
          ...jobData,
          _meta: {
            messageId,
            enqueuedAt: new Date().toISOString(),
            slackChannel: msg.channel,
            slackThreadTs: msg.ts || '',
          },
        });
        await client.chat.postMessage({
          channel: msg.channel,
          text: `:rocket: Your fix request has been queued: "${text}"`,
        });
      } catch (err) {
        log.error({ err: String(err), text }, 'Failed to process DM fix request');
        await say('Error: Failed to submit fix request.');
      }
    });
  }

  async start(): Promise<void> {
    if (!this.app) return;
    if (!this.receiver) {
      await this.app.start();
      log.info('Slack Bolt app started (Socket Mode)');
    }
  }

  mountOn(app: Express): void {
    if (!this.receiver) {
      log.warn('Bolt receiver not available — skipping mount');
      return;
    }
    app.use(this.receiver.router);
    log.info({ path: config.slack.interactionsPath }, 'Bolt receiver mounted on Express');
  }

  async sendInteractiveMessage(event: NotificationEvent, data: NotificationData): Promise<void> {
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
      log.error({ err: String(err), event, channel }, 'Failed to send interactive Slack message');
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
