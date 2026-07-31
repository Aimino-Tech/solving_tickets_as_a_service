/**
 * AIM-4443 — E2E: memory_cap.
 *
 * A 500-turn conversation must keep memory sizes within caps
 * (facts ≤ 100, decisions ≤ 50, preferences ≤ 50, plan ≤ 1).
 * Mock DATA, real memory/pod/store modules with a cap-exhausting extractor.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatPod } from '../../src/chat/pod.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';
import type { AgentMemory, MemoryDelta } from '../../src/chat/memory.js';
import { MEMORY_CAPS, applyMemoryDelta } from '../../src/chat/memory.js';

/** Every turn adds a brand-new fact, decision and preference — exercises caps. */
function capExhaustingExtractor(_prev: AgentMemory, userText: string, _reply: string): MemoryDelta {
  const n = userText.match(/turn-(\d+)/)?.[1] ?? '0';
  return {
    facts: [
      { key: `fact_${n}`, value: `value ${n}`, updatedAt: new Date().toISOString() },
      { key: `fact_common_${n % 10}`, value: `common ${n}`, updatedAt: new Date().toISOString() },
    ],
    decisions: [
      { context: `turn ${n}`, choice: `choice ${n}`, reason: 'test', ts: new Date().toISOString() },
    ],
    preferences: { [`pref_${n % 60}`]: `preference ${n}` },
  };
}

function makeExecutor(): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async () => ({ reply: 'ok' })),
  };
}

describe('memory caps under load (AIM-4443)', () => {
  it('keeps memory within caps after a 500-turn conversation', async () => {
    const store = new MemoryChatSessionStore();
    const { pod: podEnd } = InMemoryPodTransport.createPair();
    const pod = new ChatPod({
      store,
      executor: makeExecutor(),
      transport: podEnd,
      memoryExtractor: capExhaustingExtractor,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await pod.boot();

    for (let i = 1; i <= 500; i += 1) {
      await pod.handleTurn(`turn-${i} message`);
    }

    const memory = pod.memorySnapshot();
    expect(memory.facts.length).toBeLessThanOrEqual(MEMORY_CAPS.facts);
    expect(memory.decisions.length).toBeLessThanOrEqual(MEMORY_CAPS.decisions);
    expect(Object.keys(memory.preferences).length).toBeLessThanOrEqual(MEMORY_CAPS.preferences);
    expect(memory.plan).toBeNull();

    const session = await store.get('t1');
    expect(session?.agentMemory.facts.length).toBeLessThanOrEqual(MEMORY_CAPS.facts);
    expect(session?.agentMemory.decisions.length).toBeLessThanOrEqual(MEMORY_CAPS.decisions);
  });

  it('caps apply at the delta-merge level (applyMemoryDelta)', () => {
    const base = applyMemoryDelta(
      { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
      {
        facts: Array.from({ length: 200 }, (_, i) => ({
          key: `k${i}`,
          value: `v${i}`,
          updatedAt: '',
        })),
        decisions: Array.from({ length: 80 }, (_, i) => ({
          context: 'c',
          choice: `choice ${i}`,
          reason: 'r',
          ts: '',
        })),
        preferences: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, `v${i}`])),
      },
    );
    expect(base.facts.length).toBeLessThanOrEqual(MEMORY_CAPS.facts);
    expect(base.decisions.length).toBeLessThanOrEqual(MEMORY_CAPS.decisions);
    expect(Object.keys(base.preferences).length).toBeLessThanOrEqual(MEMORY_CAPS.preferences);
  });
});
