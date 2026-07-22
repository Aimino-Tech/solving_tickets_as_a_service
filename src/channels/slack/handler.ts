// @ts-nocheck
/**
 * Slack @stas mention handler.
 *
 * Listens for `app_mention` events on the Slack Bolt app, parses issue
 * references from the message text, and dispatches a STAS fix pipeline run.
 * Progress updates are posted as threaded replies.
 */

import type { App } from '@slack/bolt';
import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import { parseIssueRefs } from './issueParser.js';
import type { IssueJobData } from '../../utils/types.js';

const log = rootLogger.child({ module: 'slack-handler' });

/**
 * Register the `app_mention` handler on an existing Slack Bolt `App`.
 *
 * Call this once during server startup after the Slack Bolt app has been
 * initialized. The handler:
 *  1. Acknowledges the event immediately
 *  2. Parses issue references from the mention text
 *  3. If an issue ref is found, enqueues a STAS fix via RabbitMQ
 *  4. Posts a threaded "working on it" message
 *
 * @param boltApp - The initialized Slack Bolt `App` instance.
 */
export function registerSlackMentionHandler(boltApp: App | null): void {
  if (!boltApp) {
    log.warn('Slack Bolt app not available — @stas handler not registered');
    return;
  }

  boltApp.event('app_mention', async ({ event, client, say }) => {
    const text = (event.text || '').trim();
    const channelId = event.channel;
    const userId = event.user;
    const threadTs = event.ts;

    log.info({ text, channelId, userId, threadTs }, 'Received @stas mention');

    try {
      // Parse issue references from the mention text
      const refs = parseIssueRefs(
        text,
        config.trackers.defaultRepoOwner,
        config.trackers.defaultRepoName,
      );

      if (refs.length === 0) {
        // No issue reference found — try treating the full text as a title
        await handleFreeformRequest(text, channelId, userId, threadTs, client, say);
        return;
      }

      // Process the first issue reference (ignore subsequent refs for simplicity)
      const ref = refs[0];

      // Post a confirmation that we're working on it
      await say({
        text: `:mag: Investigating <https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}|#${ref.issueNumber}> — I'll post updates in this thread.`,
        thread_ts: threadTs,
      });

      // Enqueue the fix job
      const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import(
        '../../queue/rabbitmq.js'
      );
      if (!isConnected()) {
        await rmqConnect();
      }

      const jobData: IssueJobData = {
        installationId: config.trackers.installationId || 0,
        repoOwner: ref.owner,
        repoName: ref.repo,
        repoPrivate: false,
        issueNumber: ref.issueNumber,
        issueTitle: `Fix requested via Slack @stas for #${ref.issueNumber}`,
        issueBody: `Referenced in Slack by <@${userId}>\n\nIssue: https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}\n\nContext: ${text}`,
        source: 'slack',
        slackChannel: channelId,
        slackThreadTs: threadTs,
      };

      const messageId = `${jobData.installationId}:${ref.owner}/${ref.repo}#${ref.issueNumber}-${Date.now()}`;
      await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
        ...jobData,
        _meta: { messageId, enqueuedAt: new Date().toISOString(), slackChannel: channelId, slackThreadTs: threadTs },
      });

      log.info(
        { issueNumber: ref.issueNumber, owner: ref.owner, repo: ref.repo, messageId },
        'Enqueued fix from Slack @stas mention',
      );
    } catch (err) {
      log.error({ err: String(err), channelId, userId }, 'Failed to handle @stas mention');
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `:x: Sorry, I encountered an error processing your request: ${String(err).slice(0, 300)}`,
        });
      } catch {
        // Best-effort error notification
      }
    }
  });

  log.info('Slack @stas mention handler registered');
}

/**
 * Handle an @stas mention that doesn't contain a clear issue reference.
 * Treats the message text as a free-form fix request description.
 */
async function handleFreeformRequest(
  text: string,
  channelId: string,
  userId: string,
  threadTs: string | undefined,
  client: App['client'],
  say: (msg: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const repoOwner = config.trackers.defaultRepoOwner;
  const repoName = config.trackers.defaultRepoName;

  if (!repoOwner || !repoName) {
    await say({
      text: 'To use @stas, mention a GitHub issue like `owner/repo#123` or a full issue URL. No default repository is configured.',
      thread_ts: threadTs,
    });
    return;
  }

  // Strip the bot mention from the text to get the actual request
  const cleaned = text.replace(/<@[A-Z0-9]+>/gi, '').trim();
  const issueTitle = cleaned || 'Fix requested via Slack @stas';

  // Post confirmation
  await say({
    text: `:mag: Investigating "${issueTitle.slice(0, 200)}" — I'll post updates in this thread.`,
    thread_ts: threadTs,
  });

  try {
    const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import(
      '../../queue/rabbitmq.js'
    );
    if (!isConnected()) {
      await rmqConnect();
    }

    const jobData: IssueJobData = {
      installationId: config.trackers.installationId || 0,
      repoOwner,
      repoName,
      repoPrivate: false,
      issueNumber: 0,
      issueTitle,
      issueBody: `Submitted via Slack @stas by <@${userId}>\n\nDescription: ${issueTitle}`,
      source: 'slack',
      slackChannel: channelId,
      slackThreadTs: threadTs,
    };

    const messageId = `${jobData.installationId}:${repoOwner}/${repoName}#0-${Date.now()}`;
    await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
      ...jobData,
      _meta: { messageId, enqueuedAt: new Date().toISOString(), slackChannel: channelId, slackThreadTs: threadTs },
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to enqueue free-form Slack fix request');
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `:x: Error: Failed to submit fix request.`,
    });
  }
}
