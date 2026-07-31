// @ts-nocheck
/**
 * Slack @stas mention handler.
 *
 * Listens for `app_mention` events on the Slack Bolt app. Routes requests:
 *  1. Natural-language create-intent ("Create urgent issues on linear") →
 *     creates one or more tracker tickets (Linear/GitLab/Jira) and enqueues
 *     a STAS dispatch for each. If no explicit issue list is given, the
 *     recent conversation context is used as the issue description.
 *  2. GitHub issue references (`owner/repo#123`, `#123`, full URL) →
 *     enqueues a STAS fix pipeline run for the referenced issue.
 *  3. Free-form text → treated as a fix request title.
 * Progress updates are posted as threaded replies.
 */

import type { App } from '@slack/bolt';
import { config } from '../../config.js';
import { rootLogger } from '../../utils/logger.js';
import { parseIssueRefs } from './issueParser.js';
import type { IssueJobData } from '../../utils/types.js';

const log = rootLogger.child({ module: 'slack-handler' });

/** "create [an/the/some/new] [urgent|critical|high-priority] issue(s) [on linear|gitlab|jira]" */
const CREATE_ISSUES_RE =
  /\b(?:create|make|open|add|file|tao)\b(?:\s+(?:an?|the|some|new|urgent|critical|asap|high[\s-]*priority))*\s+(?:issue|ticket)s?(?:\s+on\s+(?:linear|gitlab|jira))?/i;

const URGENT_RE = /\b(?:urgent|urgently|asap|critical|high[\s-]*priority|nhanh|khan)\b/i;

const TRACKER_PRIORITY: Record<string, number> = {
  linear: 1, // Linear: 1=Urgent
  gitlab: 1, // GitLab: highest
  jira: 1, // Jira: highest
};

/**
 * Register the `app_mention` handler on an existing Slack Bolt `App`.
 *
 * Call this once during server startup after the Slack Bolt app has been
 * initialized. The handler:
 *  1. Acknowledges the event immediately
 *  2. Detects create-intent and creates tracker tickets (Linear by default)
 *  3. Otherwise parses issue references and enqueues a STAS fix via RabbitMQ
 *  4. Posts threaded progress updates
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
      // NL create-intent takes priority: "Create urgent issues on linear"
      if (CREATE_ISSUES_RE.test(text)) {
        await handleCreateIssuesRequest(text, channelId, userId, threadTs, client, say);
        return;
      }

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
 * Parse a create-issues request into explicit issue titles.
 *
 * Supports multi-issue formats: newline-separated, `; `-separated, ` and `
 * separated, and numbered/bulleted lists. Returns an empty array when the
 * request carries no explicit issue list (caller falls back to context).
 */
function parseCreateIssuesRequest(text: string): string[] {
  const cleaned = text.replace(/<@[A-Z0-9]+>/gi, '').trim();
  // Strip the intent phrase and any "on <tracker>" suffix
  const rest = cleaned
    .replace(CREATE_ISSUES_RE, '')
    .replace(/\bon\s+(?:linear|gitlab|jira)\b/i, '')
    .replace(/^[:,\s-]+/, '')
    .trim();

  const parts = rest
    .split(/\n|;\s*|\s+and\s+/i)
    .map((s) => s.replace(/^[-*•\d.\s]+/, '').trim())
    .filter((s) => s.length > 0);

  return parts;
}

/**
 * Fetch recent conversation context from the Slack thread (or channel) to use
 * as issue descriptions when the create request names no explicit issues.
 */
async function fetchConversationContext(
  client: App['client'],
  channelId: string,
  threadTs: string | undefined,
  limit = 10,
): Promise<string> {
  try {
    if (threadTs) {
      const res = await client.conversations.replies({ channel: channelId, ts: threadTs, limit });
      const msgs = (res.messages || [])
        .filter((m) => m.bot_id !== 'B0BM2ET8JRJ' && !String(m.text || '').startsWith('@STAS'))
        .map((m) => `<@${m.user || 'unknown'}>: ${m.text}`)
        .slice(-6);
      return msgs.join('\n') || 'No prior conversation context available.';
    }
    const res = await client.conversations.history({ channel: channelId, limit });
    const msgs = (res.messages || [])
      .filter((m) => m.bot_id !== 'B0BM2ET8JRJ' && !String(m.text || '').startsWith('@STAS'))
      .map((m) => `<@${m.user || 'unknown'}>: ${m.text}`)
      .slice(-8);
    return msgs.join('\n') || 'No prior conversation context available.';
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to fetch conversation context — using placeholder');
    return 'No conversation context could be fetched.';
  }
}

/**
 * Handle a create-intent mention ("Create urgent issues on linear").
 *
 * Creates one or more tracker tickets (Linear when no tracker is named),
 * then enqueues a STAS dispatch job per ticket so workers pick them up.
 */
async function handleCreateIssuesRequest(
  text: string,
  channelId: string,
  userId: string,
  threadTs: string | undefined,
  client: App['client'],
  say: (msg: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  try {
    // Pick the tracker: explicit "on <tracker>" or default to Linear
    const trackerMatch = text.match(/\bon\s+(linear|gitlab|jira)\b/i);
    const trackerName = trackerMatch ? trackerMatch[1].toLowerCase() : 'linear';

    const { getTracker } = await import('../../trackers/index.js');
    const tracker = getTracker(trackerName);
    if (!tracker) {
      await say({
        text: `:x: Tracker \`${trackerName}\` is not configured (missing API key in .env).`,
        thread_ts: threadTs,
      });
      return;
    }

    const urgent = URGENT_RE.test(text);
    const titles = parseCreateIssuesRequest(text);
    const context = await fetchConversationContext(client, channelId, threadTs);

    // Team/project resolution for Linear
    let teamId: string | undefined;
    if (trackerName === 'linear') {
      teamId = config.trackers.linear?.teamId;
      if (!teamId) {
        await say({
          text: ':x: `LINEAR_TEAM_ID` is not set in .env — cannot create Linear issues without a target team.',
          thread_ts: threadTs,
        });
        return;
      }
    }

    if (titles.length === 0) {
      await say({
        text: ':mag: Got it — creating an urgent issue from the conversation context…',
        thread_ts: threadTs,
      });
    } else {
      await say({
        text: `:mag: Creating ${titles.length === 1 ? '1 issue' : `${titles.length} issues`} on ${trackerName}…`,
        thread_ts: threadTs,
      });
    }

    const created: Array<{ title: string; url: string }> = [];
    const errors: string[] = [];

    // When no explicit list, derive a single issue from the conversation
    const items =
      titles.length > 0
        ? titles
        : [text.replace(CREATE_ISSUES_RE, '').replace(/\bon\s+(?:linear|gitlab|jira)\b/i, '').replace(/<@[A-Z0-9]+>/gi, '').trim() || `Urgent request from Slack conversation <#${channelId}>`];

    const { QUEUES, publishMessage, connect: rmqConnect, isConnected } = await import(
      '../../queue/rabbitmq.js'
    );
    if (!isConnected()) {
      await rmqConnect();
    }

    for (const title of items) {
      const description = `Requested via Slack @stas by <@${userId}>\n\n---\n${context}`;
      try {
        const ticket = await tracker.createTicket({
          teamId,
          title: title.slice(0, 200),
          description,
          priority: urgent ? TRACKER_PRIORITY[trackerName] ?? 1 : 2,
          labels: urgent ? ['urgent', 'stas:fix'] : ['stas:fix'],
        });
        created.push({ title: ticket.title, url: ticket.url });

        // Enqueue a dispatch so workers pick up the new ticket
        const jobData: IssueJobData = {
          installationId: config.trackers.installationId || 0,
          repoOwner: config.trackers.defaultRepoOwner || '',
          repoName: config.trackers.defaultRepoName || '',
          repoPrivate: false,
          issueNumber: 0,
          issueTitle: ticket.title,
          issueBody: description,
          source: 'linear',
          trackerType: 'linear',
          trackerTicketId: ticket.id,
        };
        const messageId = `${jobData.installationId}:${trackerName}-${ticket.id}-${Date.now()}`;
        await publishMessage(QUEUES.issuesFix.exchange, QUEUES.issuesFix.routingKey, {
          ...jobData,
          _meta: { messageId, enqueuedAt: new Date().toISOString(), slackChannel: channelId, slackThreadTs: threadTs },
        });
        log.info({ ticketId: ticket.id, title: ticket.title, messageId }, 'Created tracker ticket + enqueued dispatch');
      } catch (err) {
        errors.push(`${title.slice(0, 80)}: ${String(err).slice(0, 150)}`);
        log.error({ err: String(err), title }, 'Failed to create tracker ticket');
      }
    }

    if (created.length > 0) {
      const lines = created.map((c) => `• <${c.url}|${c.title.slice(0, 80)}>`).join('\n');
      const urgentNote = urgent ? ' *(urgent)*' : '';
      await say({
        text: `:white_check_mark: Created ${created.length === 1 ? '1 issue' : `${created.length} issues`}${urgentNote} on ${trackerName}:\n${lines}\n\n_Workers have been notified — updates will land in this thread._`,
        thread_ts: threadTs,
      });
    } else {
      await say({
        text: `:x: Could not create any issues.${errors.length ? `\n${errors.map((e) => `• ${e}`).join('\n').slice(0, 800)}` : ''}`,
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to handle create-issues request');
    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `:x: Sorry, I encountered an error creating issues: ${String(err).slice(0, 300)}`,
      });
    } catch {
      // Best-effort error notification
    }
  }
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
