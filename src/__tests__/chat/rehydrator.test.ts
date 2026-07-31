import { describe, expect, it, vi } from 'vitest';
import type { SessionMemory } from '../../agent/memory/types.js';
import { emptySessionMemory } from '../../chat/memory-block.js';
import type { ThreadTurn } from '../../chat/rehydrator.js';
import { ChatRehydrator, noThreadFetcher } from '../../chat/rehydrator.js';
import type { ChatSessionStore } from '../../chat/sessionStore.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';

function seededMemory(): SessionMemory {
  return {
    facts: [
      {
        key: 'user_name',
        content: "The user's name is Alice",
        instance: 'chat',
        source: 'user',
        tags: [],
        accessCount: 0,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      },
    ],
    decisions: [],
    preferences: [],
  };
}

async function seedStore(): Promise<ChatSessionStore> {
  const store = new MemoryChatSessionStore();
  await store.upsert({
    threadTs: 't1',
    channelId: 'c1',
    sessionId: 's1',
    userId: 'u1',
    state: {
      transcript: [
        { role: 'user', text: 'hello', ts: 'a', delivered: true },
        { role: 'assistant', text: 'hi there', ts: 'b', delivered: true },
        { role: 'user', text: 'follow-up while pod was down', ts: 'c', delivered: false },
      ],
    },
    agentMemory: seededMemory(),
  });
  return store;
}

describe('ChatRehydrator', () => {
  it('builds a seed from the durable session row', async () => {
    const store = await seedStore();
    const rehydrator = new ChatRehydrator(store);

    const seed = await rehydrator.rehydrate('t1');

    expect(seed).toBeDefined();
    expect(seed?.session.sessionId).toBe('s1');
    expect(seed?.memoryBlock).toContain('Alice');
    expect(seed?.recentTranscript.map((t) => t.text)).toEqual(['hello', 'hi there', 'follow-up while pod was down']);
    expect(seed?.pendingTurns).toEqual([
      expect.objectContaining({ role: 'user', text: 'follow-up while pod was down', delivered: false }),
    ]);
  });

  it('returns undefined when no session row exists', async () => {
    const rehydrator = new ChatRehydrator(new MemoryChatSessionStore());

    expect(await rehydrator.rehydrate('missing')).toBeUndefined();
  });

  it('backfills thread turns the store does not yet have', async () => {
    const store = await seedStore();
    const thread: ThreadTurn[] = [
      { ts: 'c', userId: 'u1', text: 'follow-up while pod was down' },
      { ts: 'd', userId: 'u1', text: 'brand new message' },
    ];
    const fetchThread = vi.fn(async () => thread);
    const rehydrator = new ChatRehydrator(store, { fetchThread });

    const seed = await rehydrator.rehydrate('t1');

    expect(fetchThread).toHaveBeenCalledWith('t1');
    expect(seed?.pendingTurns.map((t) => t.text)).toContain('brand new message');
    expect(seed?.recentTranscript.map((t) => t.text)).toContain('brand new message');
  });

  it('renders an empty memory block when nothing was curated', async () => {
    const store = new MemoryChatSessionStore();
    await store.upsert({
      threadTs: 't2',
      channelId: 'c1',
      sessionId: 's2',
      userId: 'u1',
      state: { transcript: [] },
      agentMemory: emptySessionMemory(),
    });
    const rehydrator = new ChatRehydrator(store);

    const seed = await rehydrator.rehydrate('t2');

    expect(seed?.memoryBlock).toBe('');
  });

  it('uses a no-op thread fetcher by default', async () => {
    const rehydrator = new ChatRehydrator(new MemoryChatSessionStore(), noThreadFetcher);

    expect(await noThreadFetcher.fetchThread('x')).toEqual([]);
    expect(rehydrator).toBeInstanceOf(ChatRehydrator);
  });
});
