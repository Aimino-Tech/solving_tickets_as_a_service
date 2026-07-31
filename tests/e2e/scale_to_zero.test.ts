import { describe, expect, it, vi } from 'vitest';
import { ChatGateway } from '../../src/chat/gateway.js';
import type { AgentExecutor, AgentInput } from '../../src/chat/pod.js';
import { ChatPod } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';

function makeExecutor(): AgentExecutor {
  return {
    name: 'recall',
    run: vi.fn(async (input: AgentInput) => {
      const earlier = input.recentTranscript.some((t) => t.text.includes('hi there'));
      if (earlier) return { reply: 'Welcome back! I remember you said hi there.' };
      return { reply: 'Hello!' };
    }),
  };
}

describe('scale to zero (US6)', () => {
  it('reaps the idle pod, persists the DM, and a fresh pod resumes from the store', async () => {
    const now = vi.fn(() => 1000);
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store, { idleTimeoutMs: 100, now });

    const pod1 = new ChatPod({
      store,
      executor: makeExecutor(),
      transport: InMemoryPodTransport.createPair().pod,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await pod1.boot();
    gateway.registerPod('u1', {
      userId: 'u1',
      sessionId: 's1',
      lastHeartbeat: now(),
      send: () => undefined,
      close: () => undefined,
    });
    gateway.heartbeat('u1');

    now.mockReturnValue(2000);
    const reaped = gateway.pruneStale();
    expect(reaped).toEqual(['u1']);
    expect(gateway.hasPod('u1')).toBe(false);

    const cold = await gateway.route({
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
      text: 'hi there',
      ts: 't1',
    });
    expect(cold.delivered).toBe(false);

    const pod2 = new ChatPod({
      store,
      executor: makeExecutor(),
      transport: InMemoryPodTransport.createPair().pod,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await pod2.boot();

    const reply = await pod2.handleTurn('what did I say earlier?');
    expect(reply).toBe('Welcome back! I remember you said hi there.');

    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript?.filter((t) => t.delivered === false)).toHaveLength(1);
  });
});
