import { describe, expect, it, vi } from 'vitest';
import { ChatLeadBridge, detectIntent, newTraceId } from '../../chat/bridge.js';
import { emptyMemory } from '../../chat/memory.js';

describe('chat-lead bridge (AIM-4444)', () => {
  it('detects work, conversation, and escalate intents', () => {
    expect(detectIntent('please fix this bug')).toBe('work');
    expect(detectIntent('can you look at this?')).toBe('escalate');
    expect(detectIntent('good morning')).toBe('conversation');
  });

  it('handles short work locally and returns a trace id', async () => {
    const bridge = new ChatLeadBridge();
    const res = await bridge.handoff({
      instruction: 'summarize the PR',
      memorySnapshot: emptyMemory(),
      threadRef: { threadTs: 't1', channelId: 'c1' },
      userId: 'u1',
    });
    expect(res.traceId).toMatch(/^tr_/);
    expect(res.durable).toBe(false);
    expect(res.message.kind).toBe('instruction');
  });

  it('publishes long work durably when a publisher is configured', async () => {
    const publisher = { publish: vi.fn(async () => ({ accepted: true })) };
    const bridge = new ChatLeadBridge({ publisher });
    const res = await bridge.handoff({
      instruction: 'fix this bug in the checkout flow and open a PR with tests',
      memorySnapshot: emptyMemory(),
      threadRef: { threadTs: 't1', channelId: 'c1' },
      userId: 'u1',
      workType: 'long',
    });
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(res.durable).toBe(true);
  });

  it('streams status and answers back to listeners', async () => {
    const bridge = new ChatLeadBridge();
    const statuses: string[] = [];
    const answers: string[] = [];
    bridge.onStatus((m) => statuses.push(m.progress));
    bridge.onAnswer((m) => answers.push(m.text));
    bridge.receive({ kind: 'status', traceId: 'tr_x', progress: 'checking…' });
    bridge.receive({ kind: 'answer', traceId: 'tr_x', text: 'done' });
    expect(statuses).toEqual(['checking…']);
    expect(answers).toEqual(['done']);
  });

  it('newTraceId is unique', () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });
});
