/**
 * Bridge E2E — long work path.
 *
 * "fix this bug" (a long instruction) is classified as work, written durably to
 * RabbitMQ via the bridge's publisher, and the pipeline's streamed status is
 * posted back to the same thread. Chat stays responsive for follow-ups while
 * the lead runs.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatLeadBridge } from '../../src/chat/bridge.js';
import { ChatGateway } from '../../src/chat/gateway.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { ChatPod } from '../../src/chat/pod.js';
import type { WorkItem } from '../../src/chat/rmqPublisher.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import type { PodToGatewayMessage } from '../../src/chat/transport.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';

const THREAD_TS = '1712345678.000001';
const CHANNEL_ID = 'C123';

function stubPublisher(accepted: boolean): { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => ({ accepted })) };
}

async function buildStack(opts: {
  publisher: { publish: ReturnType<typeof vi.fn> };
  leadExecutor?: AgentExecutor;
  chatReply?: string;
}): Promise<{
  bridge: ChatLeadBridge;
  gateway: ChatGateway;
  threadPosts: PodToGatewayMessage[];
}> {
  const bridge = new ChatLeadBridge({ publisher: opts.publisher });
  const store = new MemoryChatSessionStore();
  const gateway = new ChatGateway(store);

  const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
  const threadPosts: PodToGatewayMessage[] = [];
  gatewayEnd.onPodMessage((msg) => {
    if (msg.kind === 'pod_message') threadPosts.push(msg);
  });

  const chatExecutor: AgentExecutor = {
    name: 'chat',
    run: vi.fn(async () => ({ reply: opts.chatReply ?? 'chat reply' })),
  };
  const leadExecutor: AgentExecutor =
    opts.leadExecutor ??
    ({
      name: 'lead',
      run: vi.fn(async () => ({ reply: 'lead fallback' })),
    } as AgentExecutor);

  const pod = new ChatPod({
    store,
    executor: chatExecutor,
    transport: podEnd,
    bridge,
    leadExecutor,
    userId: 'U1',
    sessionId: 'sess_U1_t1',
    threadTs: THREAD_TS,
    channelId: CHANNEL_ID,
  });
  await pod.boot();

  const handle = {
    userId: 'U1',
    sessionId: 'sess_U1_t1',
    lastHeartbeat: Date.now(),
    send: (msg: { kind: string }) => gatewayEnd.sendToPod(msg as never),
    close: () => undefined,
  };
  gateway.registerPod('U1', handle as never);

  return { bridge, gateway, threadPosts };
}

describe('bridge e2e — long work', () => {
  it('"fix this bug" → work item in RMQ, status streamed to thread, chat stays responsive', async () => {
    const publisher = stubPublisher(true);
    const leadExecutor: AgentExecutor = {
      name: 'lead',
      run: vi.fn(async () => ({ reply: 'unexpected lead call' })),
    };
    const { bridge, gateway, threadPosts } = await buildStack({ publisher, leadExecutor });

    const longInstruction = 'fix this bug with a very long work instruction '.repeat(20);
    await gateway.route({
      threadTs: THREAD_TS,
      channelId: CHANNEL_ID,
      userId: 'U1',
      text: longInstruction,
    });

    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    });
    expect(leadExecutor.run).not.toHaveBeenCalled();

    const item = publisher.publish.mock.calls[0]?.[0] as WorkItem;
    expect(item).toMatchObject({
      instruction: longInstruction,
      threadRef: { threadTs: THREAD_TS, channelId: CHANNEL_ID },
      userId: 'U1',
    });
    expect(item.traceId).toMatch(/^tr_/);

    await vi.waitFor(() => {
      expect(threadPosts.some((m) => m.text?.includes('queued as'))).toBe(true);
    });

    bridge.receive({ kind: 'status', traceId: item.traceId, progress: '_fixing…_' });
    bridge.receive({
      kind: 'answer',
      traceId: item.traceId,
      text: 'Fixed the bug — tests pass, PR opened.',
    });

    await vi.waitFor(() => {
      expect(threadPosts.some((m) => m.text?.includes('Fixed the bug'))).toBe(true);
    });
    expect(threadPosts.some((m) => m.text === '_fixing…_')).toBe(true);

    await gateway.route({
      threadTs: THREAD_TS,
      channelId: CHANNEL_ID,
      userId: 'U1',
      text: 'what are you working on?',
    });
    await vi.waitFor(() => {
      expect(threadPosts.filter((m) => m.text === 'chat reply')).toHaveLength(1);
    });
  });
});
