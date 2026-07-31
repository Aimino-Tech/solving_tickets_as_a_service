/**
 * AIM-4443 — E2E: memory_upsert.
 *
 * A 10-turn conversation must maintain curated memory that reflects facts
 * established in turn 1 (not just the most recent turns). Mock DATA, real
 * memory/pod/store modules.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatPod } from '../../src/chat/pod.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';
import { ruleBasedExtractor } from '../../src/chat/memory.js';

function makeExecutor(): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async () => ({ reply: 'Understood — continuing.' })),
  };
}

function makePod(store: MemoryChatSessionStore, turn: number) {
  const { pod: podEnd } = InMemoryPodTransport.createPair();
  const pod = new ChatPod({
    store,
    executor: makeExecutor(),
    transport: podEnd,
    memoryExtractor: ruleBasedExtractor,
    userId: 'u1',
    sessionId: 's1',
    threadTs: 't1',
    channelId: 'c1',
  });
  void turn;
  return pod;
}

async function runTurns(pod: ChatPod, messages: string[]): Promise<void> {
  for (const msg of messages) {
    await pod.handleTurn(msg);
  }
}

describe('memory upsert across turns (AIM-4443)', () => {
  it('preserves turn-1 facts through a 10-turn conversation', async () => {
    const store = new MemoryChatSessionStore();
    const pod = makePod(store, 1);
    await pod.boot();

    await runTurns(pod, [
      'hi, my name is Alice and we are building a billing service',
      'what is the deadline?',
      'can we use postgres for storage?',
      'please keep it simple',
      'what language should we use?',
      'is the plan still to ship next week?',
      'we decided to use typescript',
      'what is next after the schema?',
      'please respond in german from now on',
      'final check before we wrap up',
    ]);

    const memory = pod.memorySnapshot();
    const keys = memory.facts.map((f) => f.key);

    expect(memory.facts.length).toBeGreaterThan(0);
    expect(keys).toContain('user_name');
    const name = memory.facts.find((f) => f.key === 'user_name');
    expect(name?.value).toBe('Alice');

    const session = await store.get('t1');
    expect(session?.agentMemory.facts.some((f) => f.key === 'user_name' && f.value === 'Alice')).toBe(true);
    expect(session?.state.transcript).toHaveLength(20);
  });

  it('does not leak state across different conversations', async () => {
    const store = new MemoryChatSessionStore();
    const { pod: podEnd } = InMemoryPodTransport.createPair();
    const other = new ChatPod({
      store,
      executor: makeExecutor(),
      transport: podEnd,
      memoryExtractor: ruleBasedExtractor,
      userId: 'u2',
      sessionId: 's2',
      threadTs: 't2',
      channelId: 'c1',
    });
    await other.boot();

    await runTurns(other, ['my name is Bob', 'what is the weather?']);

    const memory = other.memorySnapshot();
    expect(memory.facts.find((f) => f.key === 'user_name')?.value).toBe('Bob');

    const alice = await store.get('t1');
    expect(alice).toBeNull();
  });
});
