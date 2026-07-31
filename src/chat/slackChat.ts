/**
 * AIM-4442 — Production wiring: Slack Socket Mode ↔ ChatGateway.
 *
 * This is the gateway-side entry point for the STAS chat stack. It owns the
 * ChatGateway + session store, registers a Bolt message listener (DMs and
 * thread replies), acks instantly, routes inbound messages to the user's pod,
 * and posts pod replies back into the same Slack thread.
 *
 * Pods dial OUT over a PodTransport (never the reverse). The bridge exposes
 * `attachPodTransport()` for the gateway end of that link: pod register /
 * heartbeat / unregister messages keep the in-memory registry fresh, and
 * `pod_message` replies are posted back to Slack.
 */

import type { App } from '@slack/bolt';
import { getSlackBoltApp } from '../notifications/slack-bolt.js';
import { rootLogger } from '../utils/logger.js';
import type { GatewayInboundMessage } from './gateway.js';
import { ChatGateway } from './gateway.js';
import type { ChatSessionStore } from './sessionStore.js';
import { createSessionStore } from './sessionStore.js';
import type { PodTransport } from './transport.js';

const log = rootLogger.child({ module: 'slack-chat' });

export interface SlackPostOptions {
  channel: string;
  thread_ts: string;
  text: string;
}

export type SlackPoster = (opts: SlackPostOptions) => Promise<unknown>;

export interface ChatSlackBridgeOptions {
  store?: ChatSessionStore;
  gateway?: ChatGateway;
  ackText?: string;
  idleTimeoutMs?: number;
  pruneIntervalMs?: number;
  /** Injectable Slack poster — defaults to the Bolt client. Override in tests. */
  postMessage?: SlackPoster;
}

const DEFAULT_PRUNE_INTERVAL_MS = 15_000;

/**
 * Gateway-side Slack chat bridge.
 *
 * One pod connection = one conversation = one session. The bridge holds no
 * durable state itself: routing state lives in the registry (rebuilt from pod
 * heartbeats or the session store after a restart) and the conversation lives
 * in the durable session store.
 */
export class ChatSlackBridge {
  readonly gateway: ChatGateway;
  private readonly store: ChatSessionStore;
  private readonly postMessage: SlackPoster;
  private readonly pruneIntervalMs: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;
  private stopped = false;

  constructor(opts: ChatSlackBridgeOptions = {}) {
    this.store = opts.store ?? createSessionStore('postgres');
    this.gateway =
      opts.gateway ??
      new ChatGateway(this.store, {
        ackText: opts.ackText,
        idleTimeoutMs: opts.idleTimeoutMs,
      });
    this.postMessage = opts.postMessage ?? defaultSlackPoster;
    this.pruneIntervalMs = opts.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  }

  /**
   * Register the Bolt message listener. Handles DMs (`im`) and threaded
   * replies in channels; ignores bot messages and non-thread channel chatter.
   */
  registerOnBolt(app: App | null): void {
    if (!app || this.registered) return;
    this.registered = true;

    app.message(async ({ message }) => {
      const msg = message as {
        subtype?: string;
        channel_type?: string;
        channel?: string;
        thread_ts?: string;
        ts?: string;
        user?: string;
        text?: string;
      };
      if (msg.subtype === 'bot_message') return;
      const isDm = msg.channel_type === 'im';
      const isThreadReply = (msg.channel_type === 'channel' || msg.channel_type === 'group') && !!msg.thread_ts;
      if (!isDm && !isThreadReply) return;
      const text = (msg.text ?? '').trim();
      if (!text || !msg.channel || !msg.user || !msg.ts) return;

      const inbound: GatewayInboundMessage = {
        threadTs: msg.thread_ts ?? msg.ts,
        channelId: msg.channel,
        userId: msg.user,
        text,
        ts: msg.ts,
      };
      await this.handleInbound(inbound);
    });
  }

  /** Ack instantly (never blocks on pod availability), then route. */
  async handleInbound(msg: GatewayInboundMessage): Promise<{ delivered: boolean; sessionId: string }> {
    const ack = this.gateway.ack({ threadTs: msg.threadTs, text: msg.text });
    this.postMessage({
      channel: msg.channelId,
      thread_ts: msg.threadTs,
      text: ack.text,
    }).catch((err) => log.warn({ err: String(err), threadTs: msg.threadTs }, 'Failed to post ack'));

    const routed = await this.gateway.route(msg);
    log.info(
      { delivered: routed.delivered, sessionId: routed.sessionId, threadTs: msg.threadTs, userId: msg.userId },
      routed.delivered ? 'Chat message dispatched to pod' : 'Chat message queued for cold start',
    );
    return routed;
  }

  /**
   * Attach the gateway end of a pod transport. Handles the pod's dial-out
   * protocol: register / heartbeat / unregister update the registry, and
   * `pod_message` replies are posted back to the Slack thread.
   */
  attachPodTransport(transport: PodTransport): void {
    transport.onPodMessage((msg) => {
      switch (msg.kind) {
        case 'register':
          this.gateway.registerPod(msg.userId, {
            userId: msg.userId,
            sessionId: msg.sessionId ?? '',
            lastHeartbeat: Date.now(),
            send: (m) => transport.sendToPod(m),
            close: () => transport.close(),
          });
          break;
        case 'heartbeat':
          this.gateway.heartbeat(msg.userId);
          break;
        case 'unregister':
          this.gateway.unregisterPod(msg.userId);
          break;
        case 'pod_message':
          if (msg.channelId && msg.threadTs && msg.text) {
            this.postMessage({
              channel: msg.channelId,
              thread_ts: msg.threadTs,
              text: msg.text,
            }).catch((err) => log.warn({ err: String(err), threadTs: msg.threadTs }, 'Failed to post pod reply'));
          }
          break;
      }
    });
  }

  /** Rebuild the registry from durable session entries (stateless recovery). */
  async rebuildRegistry(): Promise<void> {
    const sessions = await this.store.listAll(10_000).catch(() => []);
    const entries = sessions.map((s) => ({ threadTs: s.threadTs, sessionId: s.sessionId, userId: s.userId }));
    this.gateway.rebuildRegistry(entries);
    log.info({ entries: entries.length }, 'Registry rebuilt from session store');
  }

  /** Start pruning stale pods periodically. Idempotent. */
  start(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      const stale = this.gateway.pruneStale();
      if (stale.length > 0) log.info({ userIds: stale }, 'Pruned stale pod connections');
    }, this.pruneIntervalMs);
    this.pruneTimer.unref?.();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.gateway.shutdown();
  }

  registrySize(): number {
    return this.gateway.registrySize();
  }

  isRegistered(): boolean {
    return this.registered;
  }
}

/** Default poster: the shared Slack Bolt app's Web API client. */
export function defaultSlackPoster(opts: SlackPostOptions): Promise<unknown> {
  const bolt = getSlackBoltApp();
  if (!bolt.app) {
    log.warn('Slack Bolt not available — chat message not posted');
    return Promise.resolve();
  }
  return bolt.app.client.chat.postMessage(opts);
}

let bridgeInstance: ChatSlackBridge | null = null;

export function getChatSlackBridge(): ChatSlackBridge | null {
  return bridgeInstance;
}

/** Create (or return the existing) gateway-side chat bridge. */
export function createChatSlackBridge(opts: ChatSlackBridgeOptions = {}): ChatSlackBridge {
  if (!bridgeInstance) bridgeInstance = new ChatSlackBridge(opts);
  return bridgeInstance;
}

/** Register the Bolt listener + start the prune loop. Idempotent. */
export function startChatSlackBridge(opts: ChatSlackBridgeOptions = {}): ChatSlackBridge {
  const bridge = createChatSlackBridge(opts);
  if (bridge.isRegistered()) {
    log.debug('Chat Slack bridge already registered');
    return bridge;
  }
  const bolt = getSlackBoltApp();
  bridge.registerOnBolt(bolt.app);
  bridge.start();
  log.info('Chat Slack bridge started');
  return bridge;
}

export function stopChatSlackBridge(): void {
  if (!bridgeInstance) return;
  bridgeInstance.stop();
  bridgeInstance = null;
  log.info('Chat Slack bridge stopped');
}
