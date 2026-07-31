import { describe, expect, it, vi } from 'vitest';
import type { SessionMemory } from '../../agent/memory/types.js';
import { ChatLeadBridge, defaultWorkType, detectIntent, newTraceId } from '../../chat/bridge.js';
import type { WorkItem, WorkPublisher } from '../../chat/rmqPublisher.js';

const memory: SessionMemory = {
  facts: [
    {
      key: 'project',
      content: 'STAS',
      instance: 'chat',
      source: 'user',
      tags: [],
      accessCount: 0,
      createdAt: 'now',
      lastAccessedAt: 'now',
    },
  ],
  decisions: [],
  preferences: [],
};

const threadRef = { threadTs: '1712345678.000001', channelId: 'C123' };

function stubPublisher(accepted = true): WorkPublisher {
  return { publish: vi.fn(async () => ({ accepted })) };
}

describe('detectIntent (AIM-4444)', () => {
  it('classifies work verbs as work', () => {
    expect(detectIntent('fix this bug')).toBe('work');
    expect(detectIntent('please review PR #12')).toBe('work');
    expect(detectIntent('summarize this PR')).toBe('work');
    expect(detectIntent('/ticket create login flow')).toBe('work');
  });

  it('escalates vague verbs for confirmation', () => {
    expect(detectIntent('can you help')).toBe('escalate');
    expect(detectIntent('make this better')).toBe('escalate');
  });

  it('classifies plain conversation as conversation', () => {
    expect(detectIntent('hi, how are you?')).toBe('conversation');
    expect(detectIntent('thanks!')).toBe('conversation');
  });
});

describe('defaultWorkType (AIM-4444)', () => {
  it('routes short instructions to the short path', () => {
    expect(defaultWorkType('summarize PR #12')).toBe('short');
  });

  it('routes long instructions (bug-fix briefs) to the durable path', () => {
    const long = `fix the flaky rate-limit test in src/services/ratelimit.ts: it intermittently
fails under load because the token bucket reset races with the test's clock fake.
Replace the fake clock with a manual ticker, assert the bucket refills after the
window elapses, and keep the existing public API unchanged. Also verify the
metrics counter increments exactly once per refill.`;
    expect(defaultWorkType(long)).toBe('long');
  });
});

describe('newTraceId (AIM-4444)', () => {
  it('produces unique trace ids', () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^tr_/);
  });
});

describe('ChatLeadBridge (AIM-4444)', () => {
  it('hands a short instruction to the lead via the instruction listener', async () => {
    const bridge = new ChatLeadBridge();
    const instructions: unknown[] = [];
    bridge.onInstruction((msg) => instructions.push(msg));

    const { traceId, durable, message } = await bridge.handoff({
      instruction: 'summarize PR #12',
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
      workType: 'short',
    });

    expect(traceId).toMatch(/^tr_/);
    expect(durable).toBe(false);
    expect(message).toMatchObject({
      kind: 'instruction',
      workType: 'short',
      instruction: 'summarize PR #12',
      threadRef,
    });
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({
      kind: 'instruction',
      traceId,
      memorySnapshot: memory,
    });
  });

  it('writes long work durably via the publisher and keeps the same traceId', async () => {
    const publisher = stubPublisher(true);
    const bridge = new ChatLeadBridge({ publisher });
    const answers: unknown[] = [];
    bridge.onAnswer((msg) => answers.push(msg));

    const { traceId, durable } = await bridge.handoff({
      instruction: 'fix this bug with a very long instruction '.repeat(20),
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
      workType: 'long',
    });

    expect(durable).toBe(true);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const item = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkItem;
    expect(item.traceId).toBe(traceId);
    expect(item.threadRef).toEqual(threadRef);
    expect(item.memorySnapshot).toEqual(memory);
  });

  it('falls back to non-durable when the publisher rejects', async () => {
    const publisher = stubPublisher(false);
    const bridge = new ChatLeadBridge({ publisher });

    const { durable } = await bridge.handoff({
      instruction: 'fix this bug with a very long instruction '.repeat(20),
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
      workType: 'long',
    });

    expect(durable).toBe(false);
  });

  it('auto-selects workType when not specified', async () => {
    const bridge = new ChatLeadBridge({ publisher: stubPublisher(true) });
    const long = 'a very long work instruction '.repeat(30);

    const short = await bridge.handoff({
      instruction: 'summarize PR #12',
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
    });
    const autoLong = await bridge.handoff({
      instruction: long,
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
    });

    expect(short.message).toMatchObject({ workType: 'short' });
    expect(short.durable).toBe(false);
    expect(autoLong.message).toMatchObject({ workType: 'long' });
    expect(autoLong.durable).toBe(true);
  });

  it('streams lead status and answers back to listeners with the traceId', () => {
    const bridge = new ChatLeadBridge();
    const statuses: unknown[] = [];
    const answers: unknown[] = [];
    bridge.onStatus((msg) => statuses.push(msg));
    bridge.onAnswer((msg) => answers.push(msg));

    bridge.receive({ kind: 'status', traceId: 'tr_1', progress: 'checking…' });
    bridge.receive({ kind: 'status', traceId: 'tr_1', progress: 'fixing…' });
    bridge.receive({ kind: 'answer', traceId: 'tr_1', text: 'done' });

    expect(statuses.map((s) => (s as { progress: string }).progress)).toEqual(['checking…', 'fixing…']);
    expect(answers).toEqual([{ kind: 'answer', traceId: 'tr_1', text: 'done' }]);
  });

  it('threads one traceId across handoff and streamed updates', async () => {
    const bridge = new ChatLeadBridge({ publisher: stubPublisher(true) });
    const events: Array<{ kind: string; traceId: string }> = [];
    bridge.onInstruction((m) => events.push({ kind: m.kind, traceId: m.traceId }));
    bridge.onStatus((m) => events.push({ kind: m.kind, traceId: m.traceId }));
    bridge.onAnswer((m) => events.push({ kind: m.kind, traceId: m.traceId }));

    const { traceId } = await bridge.handoff({
      instruction: 'fix this bug with a very long instruction '.repeat(20),
      memorySnapshot: memory,
      threadRef,
      userId: 'U123',
      workType: 'long',
    });
    bridge.receive({ kind: 'status', traceId, progress: 'running…' });
    bridge.receive({ kind: 'answer', traceId, text: 'fixed' });

    expect(events).toHaveLength(3);
    expect(events.every((e) => e.traceId === traceId)).toBe(true);
  });
});
