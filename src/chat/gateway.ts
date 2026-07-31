/**
 * AIM-4442 — Stateless Chat Gateway.
 *
 * Receives inbound chat messages, instantly acks them, and routes them to the
 * user's pod connection. The gateway holds NO durable state: the
 * `threadTs -> sessionId -> userId` registry is rebuilt from pod heartbeats
 * (or from the durable session store) after a restart. One pod connection =
 * one conversation = one session, so routing is a pure registry lookup and no
 * locking is needed.
 *
 * Cold start: when no pod is registered for a user, the message is appended to
 * the session's pendingTurns in the store and an ack ("Waking up…") is
 * returned. When the pod dials in, it drains pending turns from the store.
 */

import type { ChatSessionStore } from './sessionStore.js';

export interface PodHandle {
  userId: string;
  sessionId: string;
  lastHeartbeat: number;
  send(msg: GatewayToPodMessage): void;
  close(): void;
}

export interface GatewayToPodMessage {
  kind: 'dispatch' | 'ack' | 'shutdown';
  threadTs: string;
  channelId?: string;
  sessionId: string;
  text: string;
}

export interface GatewayInboundMessage {
  threadTs: string;
  channelId: string;
  userId: string;
  text: string;
  ts: string;
}

export interface RegistryEntry {
  threadTs: string;
  sessionId: string;
  userId: string;
}

export interface GatewayOptions {
  ackText?: string;
  idleTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_ACK_TEXT = 'Waking up…';
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export class ChatGateway {
  private readonly store: ChatSessionStore;
  private readonly ackText: string;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  /** userId -> pod */
  private readonly pods = new Map<string, PodHandle>();
  /** threadTs -> { sessionId, userId } */
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(store: ChatSessionStore, opts: GatewayOptions = {}) {
    this.store = store;
    this.ackText = opts.ackText ?? DEFAULT_ACK_TEXT;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Instant ack — returns immediately, never blocks on pod availability. */
  ack(msg: Pick<GatewayInboundMessage, 'threadTs' | 'text'>): { text: string; threadTs: string } {
    return { text: this.ackText, threadTs: msg.threadTs };
  }

  /**
   * Route an inbound message. If the user's pod is registered, dispatch
   * directly. Otherwise persist the message as a pending turn and leave the
   * pod to drain it on connect (cold start).
   */
  async route(msg: GatewayInboundMessage): Promise<{ delivered: boolean; sessionId: string }> {
    let entry = this.registry.get(msg.threadTs);
    if (!entry) {
      const existing = await this.store.get(msg.threadTs);
      const sessionId = existing?.sessionId ?? `sess_${msg.userId}_${msg.threadTs.replace(/[^\w-]/g, '_')}`;
      entry = { threadTs: msg.threadTs, sessionId, userId: msg.userId };
      this.registry.set(msg.threadTs, entry);
    }

    const pod = this.pods.get(entry.userId);
    if (pod) {
      pod.send({
        kind: 'dispatch',
        threadTs: msg.threadTs,
        channelId: msg.channelId,
        sessionId: entry.sessionId,
        text: msg.text,
      });
      return { delivered: true, sessionId: entry.sessionId };
    }

    await this.appendPending(msg, entry.sessionId);
    return { delivered: false, sessionId: entry.sessionId };
  }

  registerPod(userId: string, pod: PodHandle): void {
    this.pods.set(userId, pod);
  }

  heartbeat(userId: string): void {
    const pod = this.pods.get(userId);
    if (pod) pod.lastHeartbeat = this.now();
  }

  unregisterPod(userId: string): void {
    const pod = this.pods.get(userId);
    if (pod) {
      pod.close();
      this.pods.delete(userId);
    }
  }

  hasPod(userId: string): boolean {
    return this.pods.has(userId);
  }

  podCount(): number {
    return this.pods.size;
  }

  /** Remove pods that have not heartbeated within the idle timeout. */
  pruneStale(now = this.now()): string[] {
    const stale: string[] = [];
    for (const [userId, pod] of this.pods) {
      if (now - pod.lastHeartbeat > this.idleTimeoutMs) {
        stale.push(userId);
        pod.close();
        this.pods.delete(userId);
      }
    }
    return stale;
  }

  /**
   * Stateless recovery: rebuild the registry from durable heartbeats after a
   * gateway restart. Entries whose pods are not yet reconnected fall back to
   * cold-start behaviour (pending turns in the store).
   */
  rebuildRegistry(entries: RegistryEntry[]): void {
    this.registry.clear();
    for (const entry of entries) this.registry.set(entry.threadTs, entry);
  }

  registrySize(): number {
    return this.registry.size;
  }

  shutdown(): void {
    for (const [userId, pod] of this.pods) {
      pod.send({ kind: 'shutdown', threadTs: '', sessionId: pod.sessionId, text: '' });
      pod.close();
      this.pods.delete(userId);
    }
  }

  private async appendPending(msg: GatewayInboundMessage, sessionId: string): Promise<void> {
    const existing = await this.store.get(msg.threadTs);
    const state = existing?.state ?? { transcript: [] };
    const transcript = Array.isArray(state.transcript) ? state.transcript : [];
    transcript.push({ role: 'user', text: msg.text, ts: msg.ts, delivered: false });
    await this.store.upsert({
      threadTs: msg.threadTs,
      channelId: msg.channelId,
      sessionId,
      userId: msg.userId,
      state: { ...state, transcript },
      agentMemory: existing?.agentMemory ?? { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
    });
  }
}
