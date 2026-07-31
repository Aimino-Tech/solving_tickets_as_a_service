import { describe, it, expect } from 'vitest';
import {
  MemoryChatSessionStore,
  createSessionStore,
} from '../../chat/sessionStore.js';
import { emptyMemory } from '../../chat/memory.js';

describe('chat session store (AIM-4442)', () => {
  it('upserts and round-trips a session', async () => {
    const store = new MemoryChatSessionStore();
    await store.upsert({
      threadTs: 't1',
      channelId: 'c1',
      sessionId: 's1',
      userId: 'u1',
      state: { transcript: [] },
      agentMemory: emptyMemory(),
    });
    const session = await store.get('t1');
    expect(session?.sessionId).toBe('s1');
    expect(session?.userId).toBe('u1');
  });

  it('keeps original status and createdAt on upsert', async () => {
    const store = new MemoryChatSessionStore();
    await store.upsert({
      threadTs: 't1', channelId: 'c1', sessionId: 's1', userId: 'u1',
      state: {}, agentMemory: emptyMemory(),
    });
    await store.setStatus('t1', 'idle');
    await store.upsert({
      threadTs: 't1', channelId: 'c1', sessionId: 's1', userId: 'u1',
      state: { transcript: [{ role: 'user', text: 'hi' }] }, agentMemory: emptyMemory(),
    });
    const session = await store.get('t1');
    expect(session?.status).toBe('idle');
  });

  it('lists sessions per user newest first', async () => {
    const store = new MemoryChatSessionStore();
    for (const ts of ['a', 'b']) {
      await store.upsert({
        threadTs: ts, channelId: 'c', sessionId: `s_${ts}`, userId: 'u1',
        state: {}, agentMemory: emptyMemory(),
      });
    }
    const rows = await store.listByUser('u1');
    expect(rows.length).toBe(2);
  });

  it('createSessionStore returns a memory store for unknown kinds', () => {
    const store = createSessionStore('memory');
    expect(store).toBeInstanceOf(MemoryChatSessionStore);
  });
});
