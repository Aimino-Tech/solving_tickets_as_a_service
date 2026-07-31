import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor } from '../../chat/pod.js';
import { ChatPod } from '../../chat/pod.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';
import { InMemoryPodTransport } from '../../chat/transport.js';

function makeExecutor(reply: string): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async (input) => ({ reply: `${reply} (memory seeded: ${input.memoryBlock ? 'yes' : 'no'})` })),
  };
}

async function makePod(overrides: Partial<ConstructorParameters<typeof ChatPod>[0]> = {}) {
  const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
  const store = new MemoryChatSessionStore();
  const executor = makeExecutor('ok');
  const pod = new ChatPod({
    store,
    executor,
    transport: podEnd,
    userId: 'u1',
    sessionId: 's1',
    threadTs: 't1',
    channelId: 'c1',
    ...overrides,
  });
  await pod.boot();
  return { pod, gatewayEnd, store, executor };
}

describe('chat pod (AIM-4442/4443)', () => {
  it('registers with the gateway on boot', async () => {
    const received: unknown[] = [];
    const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
    gatewayEnd.onPodMessage((msg) => received.push(msg));
    const pod = new ChatPod({
      store: new MemoryChatSessionStore(),
      executor: makeExecutor('ok'),
      transport: podEnd,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await pod.boot();
    expect(received.map((m: any) => m.kind)).toEqual(['register', 'heartbeat']);
  });

  it('answers a dispatched message and checkpoints state+memory', async () => {
    const { gatewayEnd, store, executor } = await makePod();
    const replies: string[] = [];
    gatewayEnd.onPodMessage((msg) => {
      if (msg.kind === 'pod_message' && msg.text) replies.push(msg.text);
    });
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'hello' });
    await new Promise((r) => setTimeout(r, 10));
    expect(replies.length).toBe(1);
    expect(executor.run).toHaveBeenCalledTimes(1);
    const session = await store.get('t1');
    expect(session?.state.transcript).toHaveLength(2);
  });

  it('serializes concurrent dispatches (one in-flight turn)', async () => {
    const { pod, gatewayEnd, store } = await makePod();
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'one' });
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'two' });
    await new Promise((r) => setTimeout(r, 20));
    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<{ role: string; text: string }>;
    expect(transcript.length).toBe(4);
    void pod;
  });

  it('shutdown unregisters and closes the transport', async () => {
    const { pod, gatewayEnd } = await makePod();
    const events: string[] = [];
    gatewayEnd.onPodMessage((msg) => events.push(msg.kind));
    pod.shutdown();
    expect(events).toContain('unregister');
  });
});
