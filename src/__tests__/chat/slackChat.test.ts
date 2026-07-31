import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutor } from '../../chat/executors.js';
import type { GatewayInboundMessage } from '../../chat/gateway.js';
import { ChatPod } from '../../chat/pod.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';
import { ChatSlackBridge } from '../../chat/slackChat.js';
import { InMemoryPodTransport } from '../../chat/transport.js';

interface FakeBoltMessage {
  subtype?: string;
  channel_type?: string;
  channel?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
  text?: string;
}

type MessageListener = (ctx: { message: FakeBoltMessage }) => Promise<void>;

function makeFakeApp(): { app: { message: (cb: MessageListener) => void }; listeners: MessageListener[] } {
  const listeners: MessageListener[] = [];
  const app = { message: (cb: MessageListener) => listeners.push(cb) };
  return { app, listeners };
}

describe('ChatSlackBridge (AIM-4442 wiring)', () => {
  let store: MemoryChatSessionStore;
  let posted: Array<{ channel: string; thread_ts: string; text: string }>;
  let postMessage: (opts: { channel: string; thread_ts: string; text: string }) => Promise<unknown>;

  beforeEach(() => {
    store = new MemoryChatSessionStore();
    posted = [];
    postMessage = vi.fn(async (opts) => {
      posted.push(opts);
    });
  });

  function makeBridge(opts: { gateway?: ChatSlackBridge['gateway'] } = {}): ChatSlackBridge {
    return new ChatSlackBridge({ store, postMessage, gateway: opts.gateway });
  }

  describe('registerOnBolt', () => {
    it('routes a DM to the gateway and posts an instant ack', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);

      await listeners[0]({
        message: {
          channel_type: 'im',
          channel: 'D123',
          ts: '1111.2222',
          user: 'U1',
          text: 'hello',
        },
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]).toEqual({ channel: 'D123', thread_ts: '1111.2222', text: 'Waking up…' });
      const session = await store.get('1111.2222');
      expect(session?.userId).toBe('U1');
    });

    it('routes a threaded channel reply (message.channels with thread_ts)', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);

      await listeners[0]({
        message: {
          channel_type: 'channel',
          channel: 'C123',
          ts: '3333.4444',
          thread_ts: '1111.2222',
          user: 'U1',
          text: 'follow up',
        },
      });

      expect(posted).toHaveLength(1);
      expect(posted[0].thread_ts).toBe('1111.2222');
      const session = await store.get('1111.2222');
      expect(session?.sessionId).toContain('U1');
    });

    it('ignores bot messages and non-thread channel chatter', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);

      await listeners[0]({
        message: { channel_type: 'im', channel: 'D123', ts: '1.1', user: 'BOT', text: 'hi', subtype: 'bot_message' },
      });
      await listeners[0]({
        message: { channel_type: 'channel', channel: 'C123', ts: '2.2', user: 'U1', text: 'not a thread' },
      });

      expect(posted).toHaveLength(0);
      expect(bridge.registrySize()).toBe(0);
    });

    it('is idempotent — registering twice registers one listener', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);
      bridge.registerOnBolt(app);
      expect(listeners).toHaveLength(1);
    });
  });

  describe('cold start', () => {
    it('acks instantly and queues the turn when no pod is registered', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);

      const t0 = Date.now();
      await listeners[0]({
        message: { channel_type: 'im', channel: 'D1', ts: '10.10', user: 'U1', text: 'wake me' },
      });
      const latency = Date.now() - t0;

      expect(latency).toBeLessThan(1000);
      expect(posted[0].text).toBe('Waking up…');
      const session = await store.get('10.10');
      const transcript = session?.state.transcript as Array<{ role: string; text: string; delivered?: boolean }>;
      expect(transcript[0]).toMatchObject({ role: 'user', text: 'wake me', delivered: false });
    });

    it('a pod that boots later drains the pending turn', async () => {
      const { app, listeners } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);
      await listeners[0]({
        message: { channel_type: 'im', channel: 'D1', ts: '10.10', user: 'U1', text: 'wake me' },
      });

      const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
      const pod = new ChatPod({
        store,
        executor: createExecutor('memory'),
        transport: podEnd,
        userId: 'U1',
        sessionId: 'sess_U1_10_10',
        threadTs: '10.10',
        channelId: 'D1',
      });
      bridge.attachPodTransport(gatewayEnd);
      await pod.boot();

      expect(bridge.gateway.hasPod('U1')).toBe(true);
      expect(bridge.registrySize()).toBe(1);
      pod.shutdown();
    });
  });

  describe('attachPodTransport', () => {
    it('registers pods, heartbeats, unregisters, and posts pod replies', async () => {
      const { app } = makeFakeApp();
      const bridge = makeBridge();
      bridge.registerOnBolt(app);
      const { pod: podEnd, gateway: gatewayEnd } = InMemoryPodTransport.createPair();
      bridge.attachPodTransport(gatewayEnd);

      podEnd.sendToGateway({ kind: 'register', userId: 'U1', sessionId: 'sess_U1' });
      expect(bridge.gateway.hasPod('U1')).toBe(true);

      podEnd.sendToGateway({ kind: 'heartbeat', userId: 'U1' });
      expect(bridge.gateway.hasPod('U1')).toBe(true);

      podEnd.sendToGateway({
        kind: 'pod_message',
        userId: 'U1',
        sessionId: 'sess_U1',
        threadTs: '10.10',
        channelId: 'D1',
        text: 'the reply',
      });
      expect(posted).toContainEqual({ channel: 'D1', thread_ts: '10.10', text: 'the reply' });

      podEnd.sendToGateway({ kind: 'unregister', userId: 'U1' });
      expect(bridge.gateway.hasPod('U1')).toBe(false);
    });
  });

  describe('rebuildRegistry', () => {
    it('rebuilds the registry from the session store', async () => {
      await store.upsert({
        threadTs: '10.10',
        channelId: 'D1',
        sessionId: 'sess_U1_10_10',
        userId: 'U1',
        state: { transcript: [] },
        agentMemory: { facts: [], decisions: [], plan: null, preferences: {}, updatedAt: '' },
      });
      const bridge = makeBridge();
      await bridge.rebuildRegistry();
      expect(bridge.registrySize()).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('start/stop are idempotent and stop shuts down the gateway', async () => {
      const bridge = makeBridge();
      bridge.start();
      bridge.start();
      bridge.stop();
      bridge.stop();
    });

    it('handleInbound returns delivered status', async () => {
      const bridge = makeBridge();
      const msg: GatewayInboundMessage = {
        threadTs: '10.10',
        channelId: 'D1',
        userId: 'U1',
        text: 'hi',
        ts: '10.10',
      };
      const routed = await bridge.handleInbound(msg);
      expect(routed.delivered).toBe(false);
      expect(routed.sessionId).toContain('U1');
    });
  });
});
