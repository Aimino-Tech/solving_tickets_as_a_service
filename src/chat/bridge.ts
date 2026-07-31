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
 * the same traceId so thread + logs correlate.
 */

import type { SessionMemory } from '../agent/memory/types.js';
import type { ThreadRef, WorkItem, WorkPublisher } from './rmqPublisher.js';

export type ChatIntent = 'conversation' | 'work' | 'escalate';

export type BridgeMessage =
  | {
      kind: 'instruction';
      traceId: string;
      instruction: string;
      memorySnapshot: SessionMemory;
      threadRef: ThreadRef;
      workType: 'short' | 'long';
    }
  | { kind: 'status'; traceId: string; progress: string }
  | { kind: 'answer'; traceId: string; text: string };

export interface HandoffInput {
  instruction: string;
  memorySnapshot: SessionMemory;
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
  'summarize',
  'explain',
  'close',
  'open',
  'merge',
  'deploy',
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

/** Long instructions (roughly a real bug-fix brief) go durable via RMQ. */
export function defaultWorkType(instruction: string): 'short' | 'long' {
  return instruction.length > 200 ? 'long' : 'short';
}

export interface BridgeOptions {
  publisher?: WorkPublisher;
  now?: () => string;
}

export class ChatLeadBridge {
  private readonly publisher: WorkPublisher | null;
  private readonly now: () => string;
  private readonly statusListeners: Array<
    (msg: Extract<BridgeMessage, { kind: 'status' }>) => void
  > = [];
  private readonly answerListeners: Array<
    (msg: Extract<BridgeMessage, { kind: 'answer' }>) => void
  > = [];
  private readonly instructionListeners: Array<
    (msg: Extract<BridgeMessage, { kind: 'instruction' }>) => void
  > = [];

  constructor(opts: BridgeOptions = {}) {
    this.publisher = opts.publisher ?? null;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Chat → lead handoff. Returns a traceId that identifies the work item end
   * to end. When the publisher (RMQ) is configured and the work is long, the
   * item is written durably and the pipeline owns delivery.
   */
  async handoff(
    input: HandoffInput,
  ): Promise<{ traceId: string; durable: boolean; message: BridgeMessage }> {
    const traceId = newTraceId();
    const workType = input.workType ?? defaultWorkType(input.instruction);
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
      } satisfies WorkItem);
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
    } else if (msg.kind === 'instruction') {
      for (const cb of this.instructionListeners) cb(msg);
    }
  }

  onStatus(cb: (msg: Extract<BridgeMessage, { kind: 'status' }>) => void): void {
    this.statusListeners.push(cb);
  }

  onAnswer(cb: (msg: Extract<BridgeMessage, { kind: 'answer' }>) => void): void {
    this.answerListeners.push(cb);
  }

  onInstruction(cb: (msg: Extract<BridgeMessage, { kind: 'instruction' }>) => void): void {
    this.instructionListeners.push(cb);
  }
}
