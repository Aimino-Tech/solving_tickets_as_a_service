import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor, AgentInput } from '../../chat/pod.js';
import { ChatPod } from '../../chat/pod.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';
import type { PodToGatewayMessage } from '../../chat/transport.js';
import { InMemoryPodTransport } from '../../chat/transport.js';

function makeExecutor(reply: string): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async (input: AgentInput) => ({
      reply: `${reply} (memory seeded: ${input.memoryBlock ? 'yes' : 'no'})`,
    })),
  };
}

async function makePod(
  executor: AgentExecutor,
  observe?: (msg: PodToGatewayMessage) => void,
): Promise<{
  pod: ChatPod;
  gatewayEnd: InMemoryPodTransport;
  store: MemoryChatSessionStore;
  executor: AgentExecutor;
}> {
  const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
  if (observe) gatewayEnd.onPodMessage(observe);
  const store = new MemoryChatSessionStore();
  const pod = new ChatPod({
    store,
    executor,
    transport: podEnd,
    userId: 'u1',
    sessionId: 's1',
    threadTs: 't1',
    channelId: 'c1',
  });
  await pod.boot();
  return { pod, gatewayEnd, store, executor };
}

describe('chat pod (AIM-4442)', () => {
  it('registers with the gateway on boot', async () => {
    const received: PodToGatewayMessage[] = [];
    await makePod(makeExecutor('ok'), (msg) => received.push(msg));
    expect(received.map((m) => m.kind)).toEqual(['register', 'heartbeat']);
  });

  it('answers a dispatched message and checkpoints state + memory', async () => {
    const executor = makeExecutor('ok');
    const replies: string[] = [];
    const { gatewayEnd, store } = await makePod(executor, (msg) => {
      if (msg.kind === 'pod_message' && msg.text) replies.push(msg.text);
    });
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'hello' });

    await vi.waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    expect(executor.run).toHaveBeenCalledTimes(1);

    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript).toHaveLength(2);
    expect(transcript?.[0]).toMatchObject({ role: 'user', text: 'hello' });
    expect(transcript?.[1]).toMatchObject({ role: 'assistant' });
  });

  it('serializes concurrent dispatches (one in-flight turn)', async () => {
    const { gatewayEnd, store } = await makePod(makeExecutor('ok'));
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'one' });
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'two' });

    await vi.waitFor(async () => {
      const session = await store.get('t1');
      const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
      expect(transcript).toHaveLength(4);
    });
  });

  it('shutdown unregisters and closes the transport', async () => {
    const events: string[] = [];
    const { pod, gatewayEnd } = await makePod(makeExecutor('ok'), (msg) => events.push(msg.kind));
    await pod.shutdown();
    expect(events).toContain('unregister');
    void gatewayEnd;
  });
});
