/**
 * Bridge E2E — short work path.
 *
 * Real in-process chat stack (InMemoryPodTransport pair, MemoryChatSessionStore,
 * ChatGateway, ChatPod) with a stub lead executor and stub publisher. Simulates
 * a real user flow with mock DATA: "summarize this PR" is classified as work,
 * handed to the lead, status is streamed, and the final result is posted back
 * to the thread (pod_message reaching the gateway == thread post).
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatLeadBridge } from '../../src/chat/bridge.js';
import { ChatGateway } from '../../src/chat/gateway.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { ChatPod } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import type { PodToGatewayMessage } from '../../src/chat/transport.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';

function stubPublisher(accepted = false): { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => ({ accepted })) };
}

describe('bridge e2e — short work', () => {
  it('"summarize this PR" → lead answers, status streamed, thread receives result', async () => {
    const publisher = stubPublisher(false);
    const bridge = new ChatLeadBridge({ publisher });
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);

    const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
    const threadPosts: PodToGatewayMessage[] = [];
    gatewayEnd.onPodMessage((msg) => {
      if (msg.kind === 'pod_message') threadPosts.push(msg);
    });

    const leadExecutor: AgentExecutor = {
      name: 'lead',
      run: vi.fn(async () => ({
        reply: '**Summary of PR #12:** adds the chat ⇄ lead bridge with trace_id threading.',
      })),
    };

    const pod = new ChatPod({
      store,
      executor: {
        name: 'chat',
        run: vi.fn(async () => ({ reply: 'conversation fallback' })),
      },
      transport: podEnd,
      bridge,
      leadExecutor,
      userId: 'U1',
      sessionId: 'sess_U1_t1',
      threadTs: '1712345678.000001',
      channelId: 'C123',
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

    await gateway.route({
      threadTs: '1712345678.000001',
      channelId: 'C123',
      userId: 'U1',
      text: 'summarize this PR',
    });

    await vi.waitFor(() => {
      expect(threadPosts.some((m) => m.text?.includes('Summary of PR #12'))).toBe(true);
    });

    expect(leadExecutor.run).toHaveBeenCalledTimes(1);
    expect(publisher.publish).not.toHaveBeenCalled();

    const statusPost = threadPosts.find((m) => m.text === '_checking…_');
    expect(statusPost).toBeDefined();

    const finalPost = threadPosts.find((m) => m.text?.includes('Summary of PR #12'));
    expect(finalPost).toBeDefined();
    expect(finalPost?.threadTs).toBe('1712345678.000001');
  });
});
