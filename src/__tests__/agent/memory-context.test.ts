/**
 * Memory context hook tests — prompt injection before a turn, turn recording
 * and structured auto-learning after a turn (AIM-4443).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMemoryContext,
  recordExchange,
  recordSessionCreated,
  renderMemoryContext,
} from '../../../src/agent/memory/memory-context.js';
import { MemoryStore } from '../../../src/agent/memory/memory-store.js';

const tempDirs: string[] = [];

function makeStore(): MemoryStore {
  const dataDir = mkdtempSync(join(tmpdir(), 'memory-ctx-test-'));
  tempDirs.push(dataDir);
  return new MemoryStore({ dataDir });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildMemoryContext', () => {
  it('injects recent conversation history newest-last', () => {
    const store = makeStore();
    const sessionId = 'sess-1';
    store.addConversation({ sessionId, instance: 'dev', role: 'user', content: 'first' });
    store.addConversation({ sessionId, instance: 'dev', role: 'assistant', content: 'reply' });

    const blocks = buildMemoryContext(store, { message: 'hi', sessionId, instance: 'dev' });
    const history = blocks.find((b) => b.section === 'Recent Conversation History');
    expect(history).toBeDefined();
    expect(history?.text).toContain('user: first');
    expect(history?.text).toContain('assistant: reply');
  });

  it('injects matching facts, decisions, plan and preferences', () => {
    const store = makeStore();
    const sessionId = 'sess-2';
    store.addFact({ key: 'deadline', content: 'Oct 1', instance: 'dev', source: 'user', tags: [] });
    store.addDecision({ key: 'd1', content: 'Use JWT', instance: 'dev' });
    store.setPlan({ summary: 'Migrate auth', steps: ['JWT', 'SSO'], updatedAt: '2026-01-01T00:00:00.000Z' });
    store.addPreference({ key: 'p1', content: 'Short replies', instance: 'dev' });

    const blocks = buildMemoryContext(store, { message: 'deadline', sessionId, instance: 'dev' });
    expect(blocks.map((b) => b.section)).toEqual(
      expect.arrayContaining(['Known Facts', 'Decisions', 'Current Plan', 'Preferences']),
    );
    const facts = blocks.find((b) => b.section === 'Known Facts');
    expect(facts?.text).toContain('deadline: Oct 1');
  });

  it('returns no blocks when the store is empty', () => {
    const store = makeStore();
    const blocks = buildMemoryContext(store, { message: 'hi', sessionId: 'sess-3', instance: 'dev' });
    expect(blocks).toHaveLength(0);
  });

  it('renderMemoryContext joins blocks with section headers, undefined when empty', () => {
    const store = makeStore();
    expect(renderMemoryContext(store, { message: 'hi', sessionId: 's1', instance: 'dev' })).toBeUndefined();

    store.addFact({ key: 'k', content: 'v', instance: 'dev', source: 'user', tags: [] });
    const rendered = renderMemoryContext(store, { message: 'v', sessionId: 's1', instance: 'dev' });
    expect(rendered).toContain('[Known Facts]');
    expect(rendered).toContain('- k: v');
  });
});

describe('recordExchange', () => {
  it('records both turns of an exchange', () => {
    const store = makeStore();
    const sessionId = 'sess-4';
    recordExchange(store, {
      message: 'hello',
      response: 'Hi there!',
      sessionId,
      instance: 'dev',
      channel: 'C1',
      user: 'U1',
    });

    const entries = store.getConversations(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.role).toBe('user');
    expect(entries[1]?.role).toBe('assistant');
  });

  it('auto-learns a topic fact for substantive replies only', () => {
    const store = makeStore();
    const sessionId = 'sess-5';
    recordExchange(store, {
      message: 'tell me about the stack',
      response:
        'The stack is FastAPI for the API layer, PostgreSQL for storage and Kubernetes for deployment, with a Redis cache in front of the database to keep latency low.',
      sessionId,
      instance: 'dev',
    });

    const facts = store.searchFacts('topics', 'dev');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]?.key).toBe(`topic_${sessionId.slice(0, 8)}`);
    expect(facts[0]?.tags).toContain('auto-learned');
  });

  it('does not auto-learn for short or dismissive replies', () => {
    const store = makeStore();
    recordExchange(store, {
      message: 'ok',
      response: 'Sure.',
      sessionId: 'sess-6',
      instance: 'dev',
    });
    recordExchange(store, {
      message: 'what?',
      response: "Sorry, I don't follow.",
      sessionId: 'sess-7',
      instance: 'dev',
    });

    expect(store.searchFacts('topics', 'dev')).toHaveLength(0);
  });

  it('learns one topic fact per session', () => {
    const store = makeStore();
    const sessionId = 'sess-8';
    const longReply =
      'We should use a message queue for the ingestion pipeline and process each event idempotently, with a dead-letter queue for failures and retries capped at three attempts.';
    recordExchange(store, { message: 'a', response: longReply, sessionId, instance: 'dev' });
    recordExchange(store, { message: 'b', response: longReply, sessionId, instance: 'dev' });

    expect(store.searchFacts('topics', 'dev')).toHaveLength(1);
  });
});

describe('recordSessionCreated', () => {
  it('stores a session-start fact', () => {
    const store = makeStore();
    recordSessionCreated(store, {
      sessionId: 'sess-9',
      instance: 'dev',
      user: 'U1',
      channel: 'C1',
    });

    const facts = store.searchFacts('Session created', 'dev');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.key).toBe('session_sess-9');
    expect(facts[0]?.tags).toContain('channel:C1');
  });
});
