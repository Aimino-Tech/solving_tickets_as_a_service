import { describe, expect, it, vi } from 'vitest';
import type { GatewayInboundMessage, PodHandle, RegistryEntry } from '../../chat/gateway.js';
import { ChatGateway } from '../../chat/gateway.js';
import type { ChatSessionStore } from '../../chat/sessionStore.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';

function sessionStore(): ChatSessionStore {
  return new MemoryChatSessionStore();
}

function inbound(overrides: Partial<GatewayInboundMessage> = {}): GatewayInboundMessage {
  return {
    threadTs: 't1',
    channelId: 'c1',
    userId: 'u1',
    text: 'hello',
    ts: 'now',
    ...overrides,
  };
}

function podHandle(overrides: Partial<PodHandle> = {}): PodHandle {
  return {
    userId: 'u1',
    sessionId: 's1',
    lastHeartbeat: 0,
    send: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe('ChatGateway', () => {
  it('acks a message instantly without touching the store', () => {
    const now = vi.fn(() => 1234);
    const gateway = new ChatGateway(sessionStore(), { now });

    const result = gateway.ack(inbound());

    expect(result).toEqual({ text: 'Waking up…', threadTs: 't1' });
    expect(now).toHaveBeenCalledTimes(0);
  });

  it('uses a custom ack text when provided', () => {
    const gateway = new ChatGateway(sessionStore(), { ackText: 'On it!' });

    expect(gateway.ack(inbound()).text).toBe('On it!');
  });

  it('routes to a registered pod and delivers once', async () => {
    const gateway = new ChatGateway(sessionStore());
    const pod = podHandle();
    gateway.registerPod('u1', pod);

    const result = await gateway.route(inbound());

    expect(result).toEqual({ delivered: true, sessionId: expect.any(String) });
    expect(pod.send).toHaveBeenCalledTimes(1);
    expect(pod.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dispatch', threadTs: 't1', text: 'hello' }));
  });

  it('persists a pending turn when no pod is registered', async () => {
    const store = sessionStore();
    const gateway = new ChatGateway(store);

    const result = await gateway.route(inbound());

    expect(result).toEqual({ delivered: false, sessionId: expect.any(String) });
    const session = await store.get('t1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript).toHaveLength(1);
    expect(transcript?.[0]).toMatchObject({
      role: 'user',
      text: 'hello',
      delivered: false,
    });
  });

  it('reuses an existing session id for a known thread', async () => {
    const store = sessionStore();
    await store.upsert({
      threadTs: 't1',
      channelId: 'c1',
      sessionId: 's-existing',
      userId: 'u1',
      state: { transcript: [] },
      agentMemory: { facts: [], decisions: [], preferences: [] },
    });
    const gateway = new ChatGateway(store);

    const result = await gateway.route(inbound());

    expect(result.sessionId).toBe('s-existing');
  });

  it('prunes pods that have not heartbeated within the idle timeout', () => {
    const now = vi.fn(() => 5000);
    const gateway = new ChatGateway(sessionStore(), { idleTimeoutMs: 1000, now });
    const pod = podHandle({ lastHeartbeat: 3000 });
    gateway.registerPod('u1', pod);

    const stale = gateway.pruneStale();

    expect(stale).toEqual(['u1']);
    expect(gateway.hasPod('u1')).toBe(false);
  });

  it('keeps pods that heartbeated recently', () => {
    const now = vi.fn(() => 5000);
    const gateway = new ChatGateway(sessionStore(), { idleTimeoutMs: 1000, now });
    gateway.registerPod('u1', podHandle({ lastHeartbeat: 4500 }));

    const stale = gateway.pruneStale();

    expect(stale).toEqual([]);
    expect(gateway.hasPod('u1')).toBe(true);
  });

  it('rebuilds its registry from persisted entries', async () => {
    const gateway = new ChatGateway(sessionStore());
    const entries: RegistryEntry[] = [{ threadTs: 't1', sessionId: 's9', userId: 'u1' }];
    gateway.rebuildRegistry(entries);

    const result = await gateway.route(inbound());

    expect(result.sessionId).toBe('s9');
    expect(result.delivered).toBe(false);
  });

  it('updates the heartbeat timestamp for a pod', () => {
    const now = vi.fn(() => 1000);
    const gateway = new ChatGateway(sessionStore(), { now });
    const pod = podHandle();
    gateway.registerPod('u1', pod);

    now.mockReturnValue(2000);
    gateway.heartbeat('u1');

    expect(pod.lastHeartbeat).toBe(2000);
  });

  it('shuts down by sending shutdown to every pod', () => {
    const gateway = new ChatGateway(sessionStore());
    const pod = podHandle();
    gateway.registerPod('u1', pod);

    gateway.shutdown();

    expect(pod.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shutdown', sessionId: 's1' }));
    expect(pod.close).toHaveBeenCalledTimes(1);
    expect(gateway.podCount()).toBe(0);
  });
});
