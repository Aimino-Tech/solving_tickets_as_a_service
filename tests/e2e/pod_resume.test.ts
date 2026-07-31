import { describe, expect, it, vi } from 'vitest';
import type { MemoryExtractor } from '../../src/chat/memory.js';
import type { AgentExecutor, AgentInput } from '../../src/chat/pod.js';
import { ChatPod } from '../../src/chat/pod.js';
import { MemoryChatSessionStore } from '../../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../../src/chat/transport.js';

function makePod(store: MemoryChatSessionStore, threadTs: string) {
  return new ChatPod({
    store,
    executor: makeExecutor(),
    transport: InMemoryPodTransport.createPair().pod,
    userId: 'u1',
    sessionId: 's1',
    threadTs,
    channelId: 'c1',
    memoryExtractor: makeExtractor(),
  });
}

function makeExecutor(): AgentExecutor {
  return {
    name: 'memory-aware',
    run: vi.fn(async (input: AgentInput) => {
      const taught = /remember\s+(\w+)\s+is\s+(.+)/i.exec(input.userText);
      if (taught) {
        return { reply: `Got it: ${taught[1]} = ${taught[2]}` };
      }
      const fact = /user's (\w+) is ([\w ]+)/i.exec(input.memoryBlock);
      if (fact) {
        return { reply: `From memory: your ${fact[1]} is ${fact[2]}.` };
      }
      return { reply: "I don't remember that." };
    }),
  };
}

function makeExtractor(): MemoryExtractor {
  return (_prev, userText) => {
    const taught = /remember\s+(\w+)\s+is\s+(.+)/i.exec(userText);
    if (!taught) return {};
    return {
      facts: [
        {
          key: taught[1].toLowerCase(),
          value: `The user's ${taught[1].toLowerCase()} is ${taught[2]}`,
        },
      ],
    };
  };
}

describe('pod resume after death (US3)', () => {
  it('continues from the sessions row without the user re-explaining', async () => {
    const store = new MemoryChatSessionStore();

    const pod1 = makePod(store, 't1');
    await pod1.boot();
    const taught = await pod1.handleTurn('remember stack is TypeScript');
    expect(taught).toContain('TypeScript');
    await pod1.shutdown();

    const pod2 = makePod(store, 't1');
    await pod2.boot();

    const reply = await pod2.handleTurn('what is my stack?');

    expect(reply).toBe('From memory: your stack is TypeScript.');
    expect(pod2.memorySnapshot().facts[0]?.key).toBe('stack');
  });
});
