import { describe, expect, it } from 'vitest';
import { emptySessionMemory } from '../../chat/memory-block.js';
import type { CheckpointInput } from '../../chat/sessionStore.js';
import { createSessionStore, MemoryChatSessionStore } from '../../chat/sessionStore.js';

function checkpoint(overrides: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    threadTs: 't1',
    channelId: 'c1',
    sessionId: 's1',
    userId: 'u1',
    state: { transcript: [] },
    agentMemory: emptySessionMemory(),
    ...overrides,
  };
}

describe('MemoryChatSessionStore', () => {
  it('round-trips a session through upsert and get', async () => {
    const store = new MemoryChatSessionStore();

    await store.upsert(checkpoint());
    const session = await store.get('t1');

    expect(session).toBeDefined();
    expect(session?.sessionId).toBe('s1');
    expect(session?.userId).toBe('u1');
    expect(session?.status).toBe('active');
  });

  it('keeps an explicit status across re-upserts', async () => {
    const store = new MemoryChatSessionStore();

    await store.upsert(checkpoint());
    await store.setStatus('t1', 'idle');
    await store.upsert(checkpoint({ state: { transcript: [{ role: 'user', text: 'hi' }] } }));

    const session = await store.get('t1');
    expect(session?.status).toBe('idle');
    expect(session?.state).toEqual({
      transcript: [{ role: 'user', text: 'hi' }],
    });
  });

  it('lists all sessions for a user, newest first', async () => {
    const store = new MemoryChatSessionStore();

    await store.upsert(checkpoint({ threadTs: 't1', sessionId: 's1' }));
    await new Promise((r) => setTimeout(r, 5));
    await store.upsert(checkpoint({ threadTs: 't2', sessionId: 's2' }));
    await new Promise((r) => setTimeout(r, 5));
    await store.upsert(checkpoint({ threadTs: 't3', sessionId: 's3' }));

    const sessions = await store.listByUser('u1');
    expect(sessions.map((s) => s.sessionId)).toEqual(['s3', 's2', 's1']);
  });

  it('creates an in-memory store via the factory', () => {
    expect(createSessionStore('memory')).toBeInstanceOf(MemoryChatSessionStore);
  });

  it('removes a session', async () => {
    const store = new MemoryChatSessionStore();

    await store.upsert(checkpoint());
    await store.remove('t1');

    expect(await store.get('t1')).toBeUndefined();
  });
});
