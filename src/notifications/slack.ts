import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { NotificationEvent, NotificationData, NotificationService } from './base.js';
import { getSlackBoltApp } from './slack-bolt.js';

const log = rootLogger.child({ module: 'slack-notifier' });

const ISSUE_URL = (owner: string, repo: string, number: number) =>
  `https://github.com/${owner}/${repo}/issues/${number}`;

function formatCurrency(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

export function buildTextMessage(
  event: NotificationEvent,
  data: NotificationData,
): string {
  const bot = data.botName ?? config.stas.botName;
  const issueLink = data.issueNumber > 0
    ? `<${ISSUE_URL(data.repoOwner, data.repoName, data.issueNumber)}|#${data.issueNumber}>`
    : '';
  const repoLink = data.repoOwner && data.repoName
    ? `<https://github.com/${data.repoOwner}/${data.repoName}|${data.repoOwner}/${data.repoName}>`
    : '';

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

    case 'payment_failed': {
      const meta = data.metadata ?? {};
      const amount = meta.amountCents ? formatCurrency(Number(meta.amountCents), String(meta.currency ?? 'usd')) : 'Unknown';
      const attempts = meta.attemptCount ?? 'unknown';
      const nextAttempt = meta.nextAttempt
        ? `Next attempt: ${new Date(String(meta.nextAttempt)).toISOString()}`
        : 'No further attempts scheduled';
      return [
        `:credit_card: *Payment Failed* — ${data.issueTitle}`,
        data.reason ? `> ${data.reason}` : '',
        `> Amount: ${amount}`,
        `> Attempts: ${attempts}`,
        `> ${nextAttempt}`,
        data.email ? `> Account: ${data.email}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'payment_recovered': {
      const meta = data.metadata ?? {};
      const amount = meta.amountCents ? formatCurrency(Number(meta.amountCents), String(meta.currency ?? 'usd')) : 'Unknown';
      return [
        `:white_check_mark: *Payment Recovered* — ${data.issueTitle}`,
        data.reason ? `> ${data.reason}` : '',
        `> Amount: ${amount}`,
        data.email ? `> Account: ${data.email}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'dlq_alert': {
      const meta = data.metadata ?? {};
      const retryCount = meta.retryCount ?? '?';
      const sourceQueue = meta.sourceQueue ?? 'unknown';
      const trace = meta.stackTrace ? `\n> \`\`\`${String(meta.stackTrace).slice(0, 500)}\`\`\`` : '';
      return [
        `:skull: *DLQ Alert* — Message dead-lettered after ${retryCount} retries`,
        `> *Issue:* ${issueLink || data.issueTitle}`,
        `> *Repo:* ${repoLink}`,
        `> *Queue:* \`${sourceQueue}\``,
        data.errorMessage ? `> *Error:* ${data.errorMessage.slice(0, 500)}` : '',
        data.reason ? `> *Reason:* ${data.reason}` : '',
        trace,
        `> *Retry Count:* ${retryCount}`,
      ]
        .filter(Boolean)
        .join('\n');
    }
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
