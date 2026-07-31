/**
 * AIM-4442 — Disposable chat pod.
 *
 * The pod is the runtime that owns one conversation: it dials out to the
 * gateway, loads (or creates) the session, seeds agent memory, answers turns,
 * maintains memory after every completed turn, and checkpoints state + memory
 * to the store in a single upsert. The pod is disposable — if it dies, the
 * rehydrator rebuilds a fresh one from the store.
 */

import type {
  AgentMemory,
  MemoryDelta,
  MemoryExtractor,
} from './memory.js';
import { applyMemoryDelta, seedMemoryBlock } from './memory.js';
import type { ChatSessionStore, TranscriptEntry } from './sessionStore.js';
import type { GatewayToPodMessage, PodTransport } from './transport.js';

export interface AgentInput {
  sessionId: string;
  userText: string;
  memoryBlock: string;
  recentTranscript: Array<TranscriptEntry>;
  traceId: string;
}

export interface AgentOutput {
  reply: string;
  /** Optional memory delta suggested by the executor (e.g. an LLM curation pass). */
  memoryDelta?: MemoryDelta;
}

export interface AgentExecutor {
  readonly name: string;
  run(input: AgentInput): Promise<AgentOutput>;
}

export interface ChatPodDeps {
  store: ChatSessionStore;
  executor: AgentExecutor;
  transport: PodTransport;
  memoryExtractor?: MemoryExtractor;
  userId: string;
  sessionId: string;
  threadTs: string;
  channelId: string;
  now?: () => string;
}

const EMPTY_MEMORY: AgentMemory = { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' };

export class ChatPod {
  private readonly store: ChatSessionStore;
  private readonly executor: AgentExecutor;
  private readonly transport: PodTransport;
  private readonly memoryExtractor: MemoryExtractor;
  readonly userId: string;
  readonly sessionId: string;
  private readonly threadTs: string;
  private readonly channelId: string;
  private readonly now: () => string;

  private memory: AgentMemory = EMPTY_MEMORY;
  private state: Record<string, unknown> = { transcript: [] };
  /** Serialize turns: one in-flight turn per conversation. */
  private processing = false;
  private readonly pending: GatewayToPodMessage[] = [];
  private closed = false;

  constructor(deps: ChatPodDeps) {
    this.store = deps.store;
    this.executor = deps.executor;
    this.transport = deps.transport;
    this.memoryExtractor = deps.memoryExtractor ?? defaultExtractor;
    this.userId = deps.userId;
    this.sessionId = deps.sessionId;
    this.threadTs = deps.threadTs;
    this.channelId = deps.channelId;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Load session + memory; register with gateway via the transport. */
  async boot(): Promise<void> {
    const existing = await this.store.get(this.threadTs);
    if (existing) {
      this.memory = existing.agentMemory ?? EMPTY_MEMORY;
      this.state = existing.state ?? { transcript: [] };
    } else {
      await this.store.upsert({
        threadTs: this.threadTs,
        channelId: this.channelId,
        sessionId: this.sessionId,
        userId: this.userId,
        state: this.state,
        agentMemory: this.memory,
      });
    }
    this.transport.sendToGateway({ kind: 'register', userId: this.userId, sessionId: this.sessionId });
    this.transport.sendToGateway({ kind: 'heartbeat', userId: this.userId });
    this.transport.onGatewayMessage((msg) => this.onGatewayMessage(msg));
  }

  async handleTurn(text: string): Promise<string> {
    const traceId = `tr_${this.sessionId}_${Date.now().toString(36)}`;
    const transcript = this.transcript();
    const memoryBlock = seedMemoryBlock(this.memory);
    const { reply } = await this.executor.run({
      sessionId: this.sessionId,
      userText: text,
      memoryBlock,
      recentTranscript: transcript.slice(-5),
      traceId,
    });
    await this.curateAndCheckpoint(text, reply, traceId);
    return reply;
  }

  private onGatewayMessage(msg: GatewayToPodMessage): void {
    if (this.closed) return;
    if (msg.kind === 'shutdown') {
      this.closed = true;
      return;
    }
    if (msg.kind === 'dispatch') {
      if (this.processing) {
        this.pending.push(msg);
      } else {
        void this.processDispatch(msg);
      }
    }
  }

  private async processDispatch(msg: GatewayToPodMessage): Promise<void> {
    this.processing = true;
    try {
      const reply = await this.handleTurn(msg.text);
      // Result is posted back to the thread by the caller (ProgressSender / ack).
      this.transport.sendToGateway({
        kind: 'pod_message',
        userId: this.userId,
        sessionId: this.sessionId,
        threadTs: msg.threadTs,
        text: reply,
      });
    } finally {
      this.processing = false;
      const next = this.pending.shift();
      if (next) await this.processDispatch(next);
    }
  }

  private async curateAndCheckpoint(userText: string, reply: string, traceId: string): Promise<void> {
    const delta = this.memoryExtractor(this.memory, userText, reply);
    this.memory = applyMemoryDelta(this.memory, delta);
    const transcript = this.transcript();
    transcript.push({ role: 'user', text: userText, ts: traceId });
    transcript.push({ role: 'assistant', text: reply, ts: traceId });
    this.state = { ...this.state, transcript };
    await this.store.upsert({
      threadTs: this.threadTs,
      channelId: this.channelId,
      sessionId: this.sessionId,
      userId: this.userId,
      state: this.state,
      agentMemory: this.memory,
    });
  }

  private transcript(): TranscriptEntry[] {
    const raw = this.state.transcript;
    return Array.isArray(raw) ? (raw as TranscriptEntry[]) : [];
  }

  memorySnapshot(): AgentMemory {
    return this.memory;
  }

  shutdown(): void {
    this.closed = true;
    this.transport.sendToGateway({ kind: 'unregister', userId: this.userId });
    this.transport.close();
  }
}

function defaultExtractor(_prev: AgentMemory, _user: string, _reply: string): MemoryDelta {
  const delta: MemoryDelta = { facts: [], decisions: [], preferences: {} };
  return delta;
}
