import { describe, expect, it } from 'vitest';
import { emptyMemory } from '../../chat/memory.js';
import { buildSeedPrompt, rehydrateSession } from '../../chat/rehydrator.js';
import { MemoryChatSessionStore } from '../../chat/sessionStore.js';

describe('rehydrator (AIM-4443)', () => {
  it('creates a fresh session when none exists', async () => {
    const store = new MemoryChatSessionStore();
    const res = await rehydrateSession({
      store,
      threadTs: 't1',
      channelId: 'c1',
      userId: 'u1',
    });
    expect(res.sessionId).toContain('u1');
    expect(await store.get('t1')).not.toBeNull();
  });

  it('seeds memory and recent transcript from the stored session', async () => {
    const store = new MemoryChatSessionStore();
    const memory = emptyMemory();
    memory.facts.push({ key: 'project', value: 'syntaro', updatedAt: memory.updatedAt });
    await store.upsert({
      threadTs: 't1',
      channelId: 'c1',
      sessionId: 's1',
      userId: 'u1',
      state: {
        transcript: [
          { role: 'user', text: 'hi', ts: 'a' },
          { role: 'assistant', text: 'hello', ts: 'b' },
        ],
      },
      agentMemory: memory,
    });
    const res = await rehydrateSession({ store, threadTs: 't1', channelId: 'c1', userId: 'u1' });
    expect(res.memoryBlock).toContain('syntaro');
    expect(res.recentTranscript.length).toBe(2);
    expect(res.seedPrompt).toContain('Continue the conversation');
  });

  it('buildSeedPrompt composes memory + history', () => {
    const prompt = buildSeedPrompt('[Memory]\nproject: syntaro', [{ role: 'user', text: 'hi' }]);
    expect(prompt).toContain('[Memory]');
    expect(prompt).toContain('[Recent Conversation History]');
  });
});
