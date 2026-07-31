/**
 * AIM-4444 — Chat ⇄ Lead session bridge.
 *
 * Two opencode sessions share the pod: the user-facing chat session (answers
 * conversation) and the lead OS session (does the work). The bridge makes the
 * handoff an explicit protocol:
 *
 *   chat → lead: { kind: 'instruction', traceId, instruction, memorySnapshot, threadRef, workType }
 *   lead → chat: { kind: 'status', traceId, progress }
 *   lead → chat: { kind: 'answer', traceId, text }
 *
 * Short work executes in the lead and streams status back to the thread.
 * Long work is written to RabbitMQ (durable) and the existing dispatch
 * pipeline posts the final status back to the same thread. Every hop carries
 * the same trace_id so thread + logs correlate.
 */

import type { AgentMemory } from './memory.js';

export type ChatIntent = 'conversation' | 'work' | 'escalate';

export type BridgeMessage =
  | {
      kind: 'instruction';
      traceId: string;
      instruction: string;
      memorySnapshot: AgentMemory;
      threadRef: ThreadRef;
      workType: 'short' | 'long';
    }
  | { kind: 'status'; traceId: string; progress: string }
  | { kind: 'answer'; traceId: string; text: string };

export interface ThreadRef {
  threadTs: string;
  channelId: string;
}

export interface WorkItem {
  traceId: string;
  instruction: string;
  threadRef: ThreadRef;
  userId: string;
  memorySnapshot: AgentMemory;
}

export interface WorkPublisher {
  publish(item: WorkItem): Promise<{ accepted: boolean }>;
}

export interface HandoffInput {
  instruction: string;
  memorySnapshot: AgentMemory;
  threadRef: ThreadRef;
  userId: string;
  /** 'short' = run in lead and stream; 'long' = durable via RMQ. */
  workType?: 'short' | 'long';
}

/** Certain work verbs → definite work. */
const WORK_VERBS = [
  'fix',
  'bug',
  'issue',
  'pr',
  'pull request',
  'ticket',
  'create',
  'implement',
  'refactor',
  'optimize',
  'review',
  'migrate',
  'test',
  'write',
  'add',
  'update',
  'change',
  'investigate',
  'diagnose',
];

/** Vague verbs → uncertain; escalate (ask the user for confirmation). */
const ESCALATE_VERBS = ['do', 'handle', 'look at', 'help', 'can you', 'could you', 'make'];

export function detectIntent(text: string): ChatIntent {
  const lower = text.toLowerCase();
  if (WORK_VERBS.some((v) => lower.includes(v))) return 'work';
  if (ESCALATE_VERBS.some((v) => lower.includes(v))) return 'escalate';
  return 'conversation';
}

export function newTraceId(prefix = 'tr'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface BridgeOptions {
  publisher?: WorkPublisher;
  now?: () => string;
}

export class ChatLeadBridge {
  private readonly publisher: WorkPublisher | null;
  private readonly now: () => string;
  private readonly statusListeners: Array<(msg: Extract<BridgeMessage, { kind: 'status' }>) => void> = [];
  private readonly answerListeners: Array<(msg: Extract<BridgeMessage, { kind: 'answer' }>) => void> = [];

  constructor(opts: BridgeOptions = {}) {
    this.publisher = opts.publisher ?? null;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Chat → lead handoff. Returns a traceId that identifies the work item end
   * to end. When the publisher (RMQ) is configured and the work is long, the
   * item is written durably and the pipeline owns delivery.
   */
  async handoff(input: HandoffInput): Promise<{ traceId: string; durable: boolean; message: BridgeMessage }> {
    const traceId = newTraceId();
    const workType = input.workType ?? (input.instruction.length > 200 ? 'long' : 'short');
    const instruction: Extract<BridgeMessage, { kind: 'instruction' }> = {
      kind: 'instruction',
      traceId,
      instruction: input.instruction,
      memorySnapshot: input.memorySnapshot,
      threadRef: input.threadRef,
      workType,
    };

    let durable = false;
    if (workType === 'long' && this.publisher) {
      const res = await this.publisher.publish({
        traceId,
        instruction: input.instruction,
        threadRef: input.threadRef,
        userId: input.userId,
        memorySnapshot: input.memorySnapshot,
      });
      durable = res.accepted;
    }

    this.receive(instruction);
    return { traceId, durable, message: instruction };
  }

  /** Lead → chat: status or answer events. */
  receive(msg: BridgeMessage): void {
    if (msg.kind === 'status') {
      for (const cb of this.statusListeners) cb(msg);
    } else if (msg.kind === 'answer') {
      for (const cb of this.answerListeners) cb(msg);
    }
  }

  onStatus(cb: (msg: Extract<BridgeMessage, { kind: 'status' }>) => void): void {
    this.statusListeners.push(cb);
  }

  onAnswer(cb: (msg: Extract<BridgeMessage, { kind: 'answer' }>) => void): void {
    this.answerListeners.push(cb);
  }
}
