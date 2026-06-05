import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { NotificationEvent, NotificationData, NotificationService } from './base.js';
import { getSlackBoltApp } from './slack-bolt.js';

const log = rootLogger.child({ module: 'slack-notifier' });

const ISSUE_URL = (owner: string, repo: string, number: number) =>
  `https://github.com/${owner}/${repo}/issues/${number}`;

function buildTextMessage(
  event: NotificationEvent,
  data: NotificationData,
): string {
  const bot = data.botName ?? config.stas.botName;
  const issueLink = `<${ISSUE_URL(data.repoOwner, data.repoName, data.issueNumber)}|#${data.issueNumber}>`;
  const repoLink = `<https://github.com/${data.repoOwner}/${data.repoName}|${data.repoOwner}/${data.repoName}>`;

  switch (event) {
    case 'fix_started':
      return [
        `:mag: *${bot}* is investigating ${issueLink}`,
        `> ${data.issueTitle}`,
        `> Repo: ${repoLink}`,
      ].join('\n');

    case 'pr_created': {
      const prLink = data.prUrl
        ? `\n> PR: <${data.prUrl}|#${data.prUrl.split('/').pop()}>`
        : '';
      return [
        `:rocket: *${bot}* opened a PR for ${issueLink}`,
        `> ${data.issueTitle}`,
        `> Repo: ${repoLink}${prLink}`,
      ].join('\n');
    }

    case 'fix_failed':
      return [
        `:x: *${bot}* couldn't fix ${issueLink}`,
        `> ${data.issueTitle}`,
        `> Repo: ${repoLink}`,
        data.reason ? `> Reason: ${data.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'verification_failed':
      return [
        `:warning: *${bot}* fix for ${issueLink} failed verification`,
        `> ${data.issueTitle}`,
        `> Repo: ${repoLink}`,
        data.reason ? `> Details: ${data.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    case 'error':
      return [
        `:fire: *${bot}* encountered an error on ${issueLink}`,
        `> ${data.issueTitle}`,
        `> Repo: ${repoLink}`,
        data.errorMessage ? `> Error: ${data.errorMessage}` : '',
      ]
        .filter(Boolean)
        .join('\n');
  }
}

export class SlackNotificationService implements NotificationService {
  private bolt = getSlackBoltApp();

  constructor(
    private webhookUrl: string = config.slack.webhookUrl ?? '',
  ) {}

  async sendNotification(
    event: NotificationEvent,
    data: NotificationData,
  ): Promise<void> {
    const { webhookUrl } = this;

    const hasWebhook = !!webhookUrl;
    const hasBolt = this.bolt.app !== null;

    if (!hasWebhook && !hasBolt) {
      log.warn('No Slack integration configured — skipping notification');
      return;
    }

    if (hasBolt) {
      await this.bolt.sendInteractiveMessage(event, data);
    }

    if (hasWebhook) {
      const text = buildTextMessage(event, data);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => 'unknown');
          log.error(
            { status: response.status, body, event },
            'Slack webhook notification failed',
          );
        } else {
          log.debug(
            { event, repo: `${data.repoOwner}/${data.repoName}`, issueNumber: data.issueNumber },
            'Slack webhook notification sent',
          );
        }
      } catch (err) {
        log.error({ err: String(err), event }, 'Failed to send Slack webhook notification');
      }
    }
  }
}

export function createSlackNotifier(): NotificationService {
  return new SlackNotificationService();
}
