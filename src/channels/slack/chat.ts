/**
 * AIM-4442 — Slack chat wiring.
 *
 * Routes inbound Slack DMs through the chat gateway: an instant ack is posted
 * in the thread, then the message is dispatched to the user's pod (or persisted
 * as a pending turn when no pod is live). Pod replies come back over the pod
 * transport and are posted to the same thread by the caller-supplied
 * `postReply`.
 */

import type { App } from '@slack/bolt';
import type { ChatGateway } from '../../chat/gateway.js';
import type { PodTransport } from '../../chat/transport.js';
import { rootLogger } from '../../utils/logger.js';
import { truncateForSlack } from './truncate.js';

const log = rootLogger.child({ module: 'slack-chat' });

export interface SlackChatWireDeps {
  gateway: ChatGateway;
  /** Gateway end of the pod transport; when provided, pod replies are posted back. */
  transport?: PodTransport;
  /** Post a reply into the Slack thread (defaults to the Bolt client). */
  postReply?: (args: { channelId: string; threadTs: string; text: string }) => Promise<void>;
}

/**
 * Register the chat gateway listener on a Slack Bolt app. Safe to call when
 * the app is null (e.g. in test harnesses) — it becomes a no-op.
 */
export function registerSlackChatHandler(boltApp: App | null, deps: SlackChatWireDeps): void {
  if (!boltApp) {
    log.warn('Slack Bolt app not available — chat handler not registered');
    return;
  }

  if (deps.transport) {
    deps.transport.onPodMessage((msg) => {
      if (msg.kind !== 'pod_message' || !msg.threadTs || !msg.text) return;
      void (
        deps.postReply?.({
          channelId: msg.channelId ?? '',
          threadTs: msg.threadTs,
          text: truncateForSlack(msg.text),
        }) ?? Promise.resolve()
      ).catch((err: unknown) => {
        log.error({ err: String(err), threadTs: msg.threadTs }, 'Failed to post pod reply');
      });
    });
  }

  boltApp.message(async ({ message, client }) => {
    const msg = message as {
      subtype?: string;
      channel_type?: string;
      text?: string;
      ts?: string;
      channel?: string;
      user?: string;
    };
    if (msg.subtype === 'bot_message' || msg.channel_type !== 'im') return;
    const text = (msg.text ?? '').trim();
    if (!text) return;

    const threadTs = msg.ts ?? '';
    const channelId = msg.channel ?? '';
    const userId = msg.user ?? '';

    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: deps.gateway.ack({ threadTs, text }).text,
      });
    } catch (err) {
      log.warn({ err: String(err), channelId, threadTs }, 'Failed to post chat ack');
    }

    try {
      const { delivered, sessionId } = await deps.gateway.route({
        threadTs,
        channelId,
        userId,
        text,
        ts: threadTs,
      });
      log.info(
        { delivered, sessionId, threadTs, userId },
        delivered ? 'DM dispatched to pod' : 'DM persisted as pending (no pod live)',
      );
    } catch (err) {
      log.error({ err: String(err), threadTs, userId }, 'Failed to route DM through gateway');
    }
  });

  log.info('Slack chat gateway handler registered');
}
