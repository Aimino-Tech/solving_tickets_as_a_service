/**
 * AIM-4443 — E2E: memory_rehydrate.
 *
 * Conversation → kill pod → rehydrate → assert the memory block is seeded
 * into the fresh session and established facts are referenced (no goldfish).
 * Mock DATA, real memory/pod/rehydrator/store modules.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatPod } from '../../src/chat/pod.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';
import { rehydrateSession } from '../../src/chat/rehydrator.js';
import { ruleBasedExtractor } from '../../src/chat/memory.js';

function makeExecutor(): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async () => ({ reply: 'Acknowledged.' })),
  };
}

function bootPod(store: MemoryChatSessionStore, threadTs: string) {
  const { pod: podEnd } = InMemoryPodTransport.createPair();
  const pod = new ChatPod({
    store,
    executor: makeExecutor(),
    transport: podEnd,
    memoryExtractor: ruleBasedExtractor,
    userId: 'u1',
    sessionId: 's1',
    threadTs,
    channelId: 'c1',
  });
  return pod;
}

describe('memory rehydrate after pod kill (AIM-4443)', () => {
  it('seeds memory block into a fresh session after pod death', async () => {
    const store = new MemoryChatSessionStore();

    // Pod A: establish facts, then die.
    const podA = bootPod(store, 't1');
    await podA.boot();
    await podA.handleTurn('hi, my name is Alice and we are building a billing service');
    await podA.handleTurn('we decided to use typescript for the backend');
    podA.shutdown();

    // Rehydrate from the durable store — the pod is gone.
    const result = await rehydrateSession({
      store,
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      sessionId: 's1',
    });

    expect(result.memoryBlock).toContain('user_name');
    expect(result.memoryBlock).toContain('Alice');
    expect(result.memoryBlock).toContain('[Memory]');
    expect(result.seedPrompt).toContain('never need to re-explain');
    expect(result.recentTranscript.length).toBeGreaterThan(0);

    // Pod B boots from the same store and must carry the memory forward.
    const podB = bootPod(store, 't1');
    await podB.boot();
    const snapshot = podB.memorySnapshot();
    expect(snapshot.facts.find((f) => f.key === 'user_name')?.value).toBe('Alice');
    expect(snapshot.facts.length).toBeGreaterThanOrEqual(2);

    // Next turn sees the memory seeded (executor input carries the block).
    const memoryInputs: string[] = [];
    const { pod: podEndB } = InMemoryPodTransport.createPair();
    const podB2 = new ChatPod({
      store,
      executor: {
        name: 'test',
        run: vi.fn(async (input) => {
          memoryInputs.push(input.memoryBlock);
          return { reply: 'Continuing.' };
        }),
      },
      transport: podEndB,
      memoryExtractor: ruleBasedExtractor,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await podB2.boot();
    await podB2.handleTurn('what was the plan again?');
    expect(memoryInputs[0]).toContain('Alice');
    void podB;
  });

  it('creates a fresh empty session when none exists (cold start)', async () => {
    const store = new MemoryChatSessionStore();
    const result = await rehydrateSession({
      store,
      threadTs: 't9',
      channelId: 'c1',
      userId: 'u9',
      sessionId: 's9',
    });
    expect(result.memoryBlock).toBe('');
    expect(result.recentTranscript).toHaveLength(0);
    expect(result.seedPrompt).toContain('Continue the conversation');
    const session = await store.get('t9');
    expect(session?.agentMemory.facts).toHaveLength(0);
  });
});
