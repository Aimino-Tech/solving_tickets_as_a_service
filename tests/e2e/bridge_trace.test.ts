/**
 * Bridge E2E — trace_id threading.
 *
 * One traceId flows across every hop: chat → bridge (instruction) → lead
 * (status/answer) → thread (pod_message ts). Every message in the flow for a
 * single turn carries the same traceId.
 */

import { describe, expect, it, vi } from 'vitest';
import type { BridgeMessage } from '../../src/chat/bridge.js';
import { ChatLeadBridge } from '../../src/chat/bridge.js';
import { ChatGateway } from '../../src/chat/gateway.js';
import type { AgentExecutor } from '../../src/chat/pod.js';
import { ChatPod } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import type { PodToGatewayMessage } from '../../src/chat/transport.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';

const THREAD_TS = '1712345678.000001';
const CHANNEL_ID = 'C123';

describe('bridge e2e — trace_id', () => {
  it('threads one traceId across chat→bridge→lead→thread', async () => {
    const bridge = new ChatLeadBridge({ publisher: { publish: vi.fn(async () => ({ accepted: false })) } });
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);

    const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
    const threadPosts: PodToGatewayMessage[] = [];
    gatewayEnd.onPodMessage((msg) => {
      if (msg.kind === 'pod_message') threadPosts.push(msg);
    });

    const instructionTraceIds: string[] = [];
    const statusTraceIds: string[] = [];
    const answerTraceIds: string[] = [];
    bridge.onInstruction((m) => instructionTraceIds.push(m.traceId));
    bridge.onStatus((m) => statusTraceIds.push(m.traceId));
    bridge.onAnswer((m) => answerTraceIds.push(m.traceId));

    const leadExecutor: AgentExecutor = {
      name: 'lead',
      run: vi.fn(async () => ({ reply: '**Summary:** done' })),
    };

    const pod = new ChatPod({
      store,
      executor: { name: 'chat', run: vi.fn(async () => ({ reply: 'conversation' })) },
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

    await gateway.route({
      threadTs: THREAD_TS,
      channelId: CHANNEL_ID,
      userId: 'U1',
      text: 'summarize this PR',
    });

    await vi.waitFor(() => {
      expect(leadExecutor.run).toHaveBeenCalledTimes(1);
    });

    const expectedTraceId = instructionTraceIds[0];
    expect(expectedTraceId).toBeDefined();

    const streamed: BridgeMessage[] = [
      ...statusTraceIds.map((traceId) => ({ kind: 'status', traceId }) as BridgeMessage),
      ...answerTraceIds.map((traceId) => ({ kind: 'answer', traceId }) as BridgeMessage),
    ];
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed.every((m) => m.traceId === expectedTraceId)).toBe(true);

    const finalPost = threadPosts.find((m) => m.text?.includes('Summary:'));
    expect(finalPost).toBeDefined();
    expect(finalPost?.ts).toBe(expectedTraceId);

    const session = await store.get(THREAD_TS);
    const transcript = session?.state.transcript as Array<{ role: string; text: string; ts?: string }> | undefined;
    expect(transcript).toHaveLength(2);
    expect(transcript?.[1].ts).toBe(expectedTraceId);
  });
});
