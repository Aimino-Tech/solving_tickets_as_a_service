import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import { getSlackBoltApp } from '../../notifications/slack-bolt.js';

const log = rootLogger.child({ module: 'slack-progress-sender' });

const phaseEmoji: Record<string, string> = {
  queued: ':hourglass_flowing_sand:',
  investigating: ':mag:',
  fixing: ':hammer:',
  testing: ':test_tube:',
  verifying: ':white_check_mark:',
  committing: ':inbox_tray:',
  pr_created: ':rocket:',
  completed: ':white_check_mark:',
  failed: ':x:',
  error: ':fire:',
};

export class SlackProgressSender {
  async sendProgress(
    slackChannel: string,
    slackThreadTs: string | undefined,
    phase: string,
    message: string,
    prUrl?: string,
  ): Promise<void> {
    const bolt = getSlackBoltApp();
    if (!bolt.app) {
      log.warn('Slack Bolt not available — skipping progress update');
      return;
    }

    const emoji = phaseEmoji[phase] || ':arrow_right:';
    let text = `${emoji} *${phase}* — ${message}`;
    if (prUrl) {
      text += `\nPR: <${prUrl}|View PR>`;
    }

    try {
      await bolt.app.client.chat.postMessage({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      } as Parameters<typeof bolt.app.client.chat.postMessage>[0]);

      log.debug({ slackChannel, phase }, 'Slack progress update sent');
    } catch (err) {
      log.error({ err: String(err), slackChannel, phase }, 'Failed to send Slack progress update');
    }
  }

  async sendResult(
    slackChannel: string,
    slackThreadTs: string | undefined,
    success: boolean,
    summary: string,
    prUrl?: string,
  ): Promise<void> {
    const bolt = getSlackBoltApp();
    if (!bolt.app) return;

    const emoji = success ? ':white_check_mark:' : ':x:';
    const status = success ? 'Completed' : 'Failed';
    let text = `${emoji} *${status}* — ${summary}`;
    if (prUrl) {
      text += `\nPR: <${prUrl}|View Pull Request>`;
    }

    try {
      await bolt.app.client.chat.postMessage({
        channel: slackChannel,
        thread_ts: slackThreadTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      } as Parameters<typeof bolt.app.client.chat.postMessage>[0]);

      log.debug({ slackChannel, success }, 'Slack result sent');
    } catch (err) {
      log.error({ err: String(err), slackChannel }, 'Failed to send Slack result');
    }
  }
}

let _instance: SlackProgressSender | null = null;

export function getSlackProgressSender(): SlackProgressSender {
  if (!_instance) {
    _instance = new SlackProgressSender();
  }
  return _instance;
}
