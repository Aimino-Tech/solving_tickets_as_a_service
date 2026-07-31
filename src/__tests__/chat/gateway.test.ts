import { describe, expect, it } from 'vitest';
import { ChatGateway } from '../../chat/gateway.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';

function sessionStore() {
  return new MemoryChatSessionStore();
}

function inbound(overrides: Partial<Parameters<ChatGateway['route']>[0]> = {}) {
  return {
    threadTs: 't1',
    channelId: 'c1',
    userId: 'u1',
    text: 'hello',
    ts: 'now',
    ...overrides,
  };
}

describe('chat gateway (AIM-4442)', () => {
  it('acks instantly regardless of pod availability', () => {
    const gw = new ChatGateway(sessionStore(), { now: () => 1000 });
    const ack = gw.ack(inbound());
    expect(ack.text).toBe('Waking up…');
    expect(ack.threadTs).toBe('t1');
  });

  it('routes to a registered pod and reports delivered', async () => {
    const gw = new ChatGateway(sessionStore());
    const sent: unknown[] = [];
    gw.registerPod('u1', {
      userId: 'u1',
      sessionId: 's1',
      lastHeartbeat: Date.now(),
      send: (msg) => sent.push(msg),
      close: () => undefined,
    });
    const result = await gw.route(inbound());
    expect(result.delivered).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('persists a pending turn when no pod is registered (cold start)', async () => {
    const store = sessionStore();
    const gw = new ChatGateway(store);
    const result = await gw.route(inbound());
    expect(result.delivered).toBe(false);
    const session = await store.get('t1');
    expect(session?.state.transcript).toHaveLength(1);
  });

  it('prunes stale pods after the idle timeout', () => {
    const gw = new ChatGateway(sessionStore(), { idleTimeoutMs: 1000, now: () => 5000 });
    gw.registerPod('u1', {
      userId: 'u1',
      sessionId: 's1',
      lastHeartbeat: 3000,
      send: () => undefined,
      close: () => undefined,
    });
    const stale = gw.pruneStale(5000);
    expect(stale).toEqual(['u1']);
    expect(gw.hasPod('u1')).toBe(false);
  });

  it('rebuilds the registry from durable entries after a restart', async () => {
    const gw = new ChatGateway(sessionStore());
    gw.rebuildRegistry([{ threadTs: 't1', sessionId: 's1', userId: 'u1' }]);
    const result = await gw.route(inbound());
    expect(result.sessionId).toBe('s1');
  });

  it('shutdown notifies all pods', () => {
    const gw = new ChatGateway(sessionStore());
    const sent: unknown[] = [];
    gw.registerPod('u1', {
      userId: 'u1',
      sessionId: 's1',
      lastHeartbeat: Date.now(),
      send: (msg) => sent.push(msg),
      close: () => undefined,
    });
    gw.shutdown();
    expect(sent.length).toBeGreaterThan(0);
    expect(gw.podCount()).toBe(0);
  });
});
