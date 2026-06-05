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
  return !!(config.slack.botToken && config.slack.signingSecret);
}

function buildBlocks(event: NotificationEvent, data: NotificationData): any[] {
  const bot = data.botName ?? config.stas.botName;
  const issueUrl = ISSUE_URL(data.repoOwner, data.repoName, data.issueNumber);
  const repoUrl = `https://github.com/${data.repoOwner}/${data.repoName}`;

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
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${issueUrl}|#${data.issueNumber}: ${data.issueTitle}>*\n<${repoUrl}|${data.repoOwner}/${data.repoName}>`,
      },
    },
  ];

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

  const actionElements: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'View Issue', emoji: true },
      url: issueUrl,
      action_id: 'view_issue',
    },
  ];

  if (event === 'pr_created' && data.prUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'View PR', emoji: true },
      url: data.prUrl,
      action_id: 'view_pr',
    });
  }

  blocks.push({
    type: 'actions',
    elements: actionElements,
  });

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
      } as any);
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
