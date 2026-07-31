import { describe, expect, it, vi } from 'vitest';
import type { BridgeMessage } from '../../chat/bridge.js';
import { ChatLeadBridge } from '../../chat/bridge.js';
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

function stubPublisher(accepted: boolean): { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => ({ accepted })) };
}

async function makeBridgedPod(
  opts: {
    bridge?: ChatLeadBridge;
    chatExecutor?: AgentExecutor;
    leadExecutor?: AgentExecutor;
    observe?: (msg: PodToGatewayMessage) => void;
  } = {},
): Promise<{
  pod: ChatPod;
  gatewayEnd: InMemoryPodTransport;
  store: MemoryChatSessionStore;
  bridge: ChatLeadBridge;
  chatExecutor: AgentExecutor;
  leadExecutor: AgentExecutor;
}> {
  const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
  if (opts.observe) gatewayEnd.onPodMessage(opts.observe);
  const store = new MemoryChatSessionStore();
  const chatExecutor = opts.chatExecutor ?? makeExecutor('chat reply');
  const leadExecutor = opts.leadExecutor ?? makeExecutor('lead done');
  const bridge = opts.bridge ?? new ChatLeadBridge({ publisher: stubPublisher(false) });
  const pod = new ChatPod({
    store,
    executor: chatExecutor,
    transport: podEnd,
    bridge,
    leadExecutor,
    userId: 'u1',
    sessionId: 's1',
    threadTs: 't1',
    channelId: 'c1',
  });
  await pod.boot();
  return { pod, gatewayEnd, store, bridge, chatExecutor, leadExecutor };
}

describe('chat pod bridge (AIM-4444)', () => {
  it('answers conversation directly without touching the lead', async () => {
    const { gatewayEnd, chatExecutor, leadExecutor, store } = await makeBridgedPod();
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'hi, how are you?' });

    await vi.waitFor(async () => {
      const session = await store.get('t1');
      const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
      expect(transcript).toHaveLength(2);
    });
    expect(chatExecutor.run).toHaveBeenCalledTimes(1);
    expect(leadExecutor.run).toHaveBeenCalledTimes(0);
  });

  it('hands short work to the lead, streams status, and answers', async () => {
    const bridgeEvents: BridgeMessage[] = [];
    const leadReply = 'fixed the bug';
    const { gatewayEnd, bridge, leadExecutor, store } = await makeBridgedPod({
      leadExecutor: {
        name: 'lead',
        run: vi.fn(async () => ({ reply: leadReply })),
      },
    });
    bridge.onStatus((m) => bridgeEvents.push(m));
    bridge.onAnswer((m) => bridgeEvents.push(m));
    const replies: string[] = [];

    gatewayEnd.onPodMessage((m) => {
      if (m.kind === 'pod_message' && m.text) replies.push(m.text);
    });
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'fix this bug' });

    await vi.waitFor(() => {
      expect(leadExecutor.run).toHaveBeenCalledTimes(1);
    });
    expect(bridgeEvents.some((e) => e.kind === 'status' && e.progress === '_checking…_')).toBe(true);
    expect(bridgeEvents.some((e) => e.kind === 'answer' && e.text === leadReply)).toBe(true);
    expect(replies).toContain(leadReply);

    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript).toHaveLength(2);
    expect(transcript?.[1]).toMatchObject({ role: 'assistant', text: leadReply });
  });

  it('writes long work durably and replies with the queue ack', async () => {
    const publisher = stubPublisher(true);
    const bridge = new ChatLeadBridge({ publisher });
    const leadExecutor = makeExecutor('lead done');
    const replies: string[] = [];
    const { gatewayEnd, store } = await makeBridgedPod({
      bridge,
      leadExecutor,
      observe: (m) => {
        if (m.kind === 'pod_message' && m.text) replies.push(m.text);
      },
    });

    const long = 'fix this bug with a very long work instruction '.repeat(20);
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: long });

    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(replies.some((r) => r.includes('queued as'))).toBe(true);
    });
    expect(leadExecutor.run).toHaveBeenCalledTimes(0);

    const item = publisher.publish.mock.calls[0]?.[0] as { threadRef: unknown; instruction: string };
    expect(item).toMatchObject({
      threadRef: { threadTs: 't1', channelId: 'c1' },
      instruction: long,
    });

    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript).toHaveLength(2);
  });

  it('escalates uncertain intents with a confirmation question', async () => {
    const { gatewayEnd, chatExecutor, leadExecutor, store } = await makeBridgedPod();
    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'can you help?' });

    await vi.waitFor(async () => {
      const session = await store.get('t1');
      const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
      expect(transcript).toHaveLength(2);
      expect(transcript?.[1]).toMatchObject({
        role: 'assistant',
        text: 'Should I kick off a fix for that? Just say yes and I will.',
      });
    });
    expect(chatExecutor.run).toHaveBeenCalledTimes(0);
    expect(leadExecutor.run).toHaveBeenCalledTimes(0);
  });

  it('threads one traceId from handoff through streamed status and answer', async () => {
    const statuses: BridgeMessage[] = [];
    const answers: BridgeMessage[] = [];
    const leadReply = 'done';
    const { gatewayEnd, bridge, leadExecutor } = await makeBridgedPod({
      leadExecutor: { name: 'lead', run: vi.fn(async () => ({ reply: leadReply })) },
    });
    bridge.onStatus((m) => statuses.push(m));
    bridge.onAnswer((m) => answers.push(m));

    gatewayEnd.sendToPod({ kind: 'dispatch', threadTs: 't1', sessionId: 's1', text: 'summarize PR #12' });

    await vi.waitFor(() => {
      expect(leadExecutor.run).toHaveBeenCalledTimes(1);
    });
    const all: BridgeMessage[] = [...statuses, ...answers];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((m) => m.traceId === statuses[0]?.traceId ?? answers[0]?.traceId)).toBe(true);
  });
});
