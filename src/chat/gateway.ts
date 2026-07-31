/**
 * AIM-4442 — chat gateway.
 *
 * Stateless router between Slack and pods. The gateway itself holds no durable
 * state: it keeps an in-memory registry of `threadTs → (sessionId, userId)` and
 * a map of live pod connections, both rebuilt from pod heartbeats after a
 * restart. Inbound DMs get an instant ack and are dispatched to the owning pod;
 * if no pod is live the message is persisted as pending so the rehydrated pod
 * picks it up when it dials back in.
 */

import { emptySessionMemory } from './memory-block.js';
import type { ChatSessionStore } from './sessionStore.js';
import type { GatewayToPodMessage } from './transport.js';

export interface PodHandle {
  userId: string;
  sessionId: string;
  lastHeartbeat: number;
  send(msg: GatewayToPodMessage): void;
  close(): void;
}

export interface GatewayInboundMessage {
  threadTs: string;
  channelId: string;
  userId: string;
  text: string;
  ts?: string;
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

export const DEFAULT_ACK_TEXT = 'Waking up…';
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export class ChatGateway {
  readonly store: ChatSessionStore;
  readonly ackText: string;
  readonly idleTimeoutMs: number;
  readonly now: () => number;

  private readonly pods = new Map<string, PodHandle>();
  private readonly registry = new Map<string, RegistryEntry>();

  constructor(store: ChatSessionStore, options: GatewayOptions = {}) {
    this.store = store;
    this.ackText = options.ackText ?? DEFAULT_ACK_TEXT;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** Instant acknowledgement — never blocks on store or pods. */
  ack(msg: Pick<GatewayInboundMessage, 'threadTs' | 'text'>): { text: string; threadTs: string } {
    return { text: this.ackText, threadTs: msg.threadTs };
  }

  /** Route a user message to the owning pod (or persist it as pending). */
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
    if (!pod) return;
    pod.close();
    this.pods.delete(userId);
  }

  hasPod(userId: string): boolean {
    return this.pods.has(userId);
  }

  podCount(): number {
    return this.pods.size;
  }

  /** Drop pods that have not heartbeated within the idle window. */
  pruneStale(now = this.now()): string[] {
    const stale: string[] = [];
    for (const [userId, pod] of this.pods) {
      if (now - pod.lastHeartbeat > this.idleTimeoutMs) {
        pod.close();
        this.pods.delete(userId);
        stale.push(userId);
      }
    }
    return stale;
  }

  /** Rebuild the registry from durable heartbeats after a gateway restart. */
  rebuildRegistry(entries: RegistryEntry[]): void {
    this.registry.clear();
    for (const entry of entries) this.registry.set(entry.threadTs, entry);
  }

  registrySize(): number {
    return this.registry.size;
  }

  async shutdown(): Promise<void> {
    for (const [userId, pod] of this.pods) {
      pod.send({
        kind: 'shutdown',
        threadTs: '',
        channelId: '',
        sessionId: pod.sessionId,
        text: '',
      });
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
      agentMemory: existing?.agentMemory ?? emptySessionMemory(),
    });
  }
}
