import { describe, expect, it } from 'vitest';
import { ChatGateway } from '../../src/chat/gateway.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';

describe('chat ack (AIM-4442)', () => {
  it('acks a DM in under a second with no pod running', async () => {
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);

    const started = performance.now();
    const ack = gateway.ack({ threadTs: 'dm-1', text: 'hello syntaro' });
    const elapsed = performance.now() - started;

    expect(ack).toEqual({ text: 'Waking up…', threadTs: 'dm-1' });
    expect(elapsed).toBeLessThan(1000);
    expect(gateway.hasPod('U456')).toBe(false);
  });

  it('persists a cold-start DM as a pending turn until a pod is live', async () => {
    const store = new MemoryChatSessionStore();
    const gateway = new ChatGateway(store);

    const result = await gateway.route({
      threadTs: 'dm-1',
      channelId: 'D123',
      userId: 'U456',
      text: 'hello syntaro',
      ts: 'dm-1',
    });

    expect(result.delivered).toBe(false);

    const session = await store.get('dm-1');
    const transcript = session?.state.transcript as Array<Record<string, unknown>> | undefined;
    expect(transcript).toContainEqual(expect.objectContaining({ role: 'user', text: 'hello syntaro', delivered: false }));
  });
});
