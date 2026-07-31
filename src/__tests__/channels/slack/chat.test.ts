import { describe, expect, it, vi } from 'vitest';
import { registerSlackChatHandler } from '../../../channels/slack/chat.js';
import { ChatGateway } from '../../../chat/gateway.js';
import type { AgentExecutor } from '../../../chat/pod.js';
import { ChatPod } from '../../../chat/pod.js';
import { MemoryChatSessionStore } from '../../../chat/sessionStore.js';
import { InMemoryPodTransport } from '../../../chat/transport.js';

type MessageCb = (ctx: {
  message: Record<string, unknown>;
  client: { chat: { postMessage: ReturnType<typeof vi.fn> } };
}) => Promise<void>;

function fakeBolt(): { app: { message: ReturnType<typeof vi.fn> }; captured: () => MessageCb } {
  let captured: MessageCb = async () => {};
  const message = vi.fn((cb: MessageCb) => {
    captured = cb;
  });
  return { app: { message }, captured: () => captured };
}

function fakeClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

function makeExecutor(reply: string): AgentExecutor {
  return {
    name: 'test',
    run: vi.fn(async () => ({ reply })),
  };
}

describe('registerSlackChatHandler (AIM-4442)', () => {
  it('posts an instant ack and routes the DM to the pod, posting the reply back', async () => {
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);
    const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
    const client = fakeClient();
    const postReply = vi.fn().mockResolvedValue(undefined);

    gateway.registerPod('u1', {
      userId: 'u1',
      sessionId: 's1',
      lastHeartbeat: Date.now(),
      send: (msg) => gatewayEnd.sendToPod(msg),
      close: () => undefined,
    });

    const pod = new ChatPod({
      store,
      executor: makeExecutor('hi'),
      transport: podEnd,
      userId: 'u1',
      sessionId: 's1',
      threadTs: 't1',
      channelId: 'c1',
    });
    await pod.boot();

    const bolt = fakeBolt();
    registerSlackChatHandler(bolt.app as never, {
      gateway,
      transport: gatewayEnd,
      postReply,
    });

    await bolt.captured()({
      message: {
        subtype: undefined,
        channel_type: 'im',
        text: 'hello',
        ts: 't1',
        channel: 'c1',
        user: 'u1',
      },
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: 'c1',
      thread_ts: 't1',
      text: 'Waking up…',
    });

    await vi.waitFor(() => {
      expect(postReply).toHaveBeenCalledWith({
        channelId: 'c1',
        threadTs: 't1',
        text: 'hi',
      });
    });
  });

  it('persists the DM as a pending turn when no pod is registered', async () => {
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);
    const client = fakeClient();
    const postReply = vi.fn();

    const bolt = fakeBolt();
    registerSlackChatHandler(bolt.app as never, { gateway, postReply });

    await bolt.captured()({
      message: {
        subtype: undefined,
        channel_type: 'im',
        text: 'hello',
        ts: 't1',
        channel: 'c1',
        user: 'u1',
      },
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    const session = await store.get('t1');
    expect(session?.state.transcript).toHaveLength(1);
    expect(postReply).not.toHaveBeenCalled();
  });

  it('ignores bot messages and non-DM channels', async () => {
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);
    const client = fakeClient();
    const postReply = vi.fn();

    const bolt = fakeBolt();
    registerSlackChatHandler(bolt.app as never, { gateway, postReply });
    const handler = bolt.captured();

    await handler({
      message: {
        subtype: 'bot_message',
        channel_type: 'im',
        text: 'hello',
        ts: 't1',
        channel: 'c1',
        user: 'u1',
      },
      client,
    });
    await handler({
      message: {
        subtype: undefined,
        channel_type: 'channel',
        text: 'hello',
        ts: 't2',
        channel: 'C123',
        user: 'u1',
      },
      client,
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(await store.get('t1')).toBeUndefined();
    expect(await store.get('t2')).toBeUndefined();
  });
});
