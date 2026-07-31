/**
 * Memory store tests — upsert-by-key, LRU cap eviction, persistence and
 * rehydrate (seed → recall) for the AIM-4443 Hermes-style memory module.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryStore } from '../../../src/agent/memory/memory-store.js';
import { MEMORY_LIMITS } from '../../../src/agent/memory/types.js';

const tempDirs: string[] = [];

function makeStore(overrides?: Partial<ConstructorParameters<typeof MemoryStore>[0]>): MemoryStore {
  const dataDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
  tempDirs.push(dataDir);
  return new MemoryStore({ dataDir, ...overrides });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('MemoryStore', () => {
  it('upserts facts by (key, instance) and bumps access count', () => {
    const store = makeStore();
    const first = store.addFact({
      key: 'user_name',
      content: 'User prefers short replies',
      instance: 'dev',
      source: 'user',
      tags: ['user'],
    });
    const second = store.addFact({
      key: 'user_name',
      content: 'User prefers short replies',
      instance: 'dev',
      source: 'user',
      tags: ['user'],
    });

    expect(second.accessCount).toBe(2);
    const facts = store.getFacts('dev');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.key).toBe('user_name');
    expect(first.key).toBe('user_name');
  });

  it('keeps facts for different instances separate', () => {
    const store = makeStore();
    store.addFact({ key: 'stack', content: 'FastAPI', instance: 'a', source: 'user', tags: [] });
    store.addFact({ key: 'stack', content: 'Django', instance: 'b', source: 'user', tags: [] });

    expect(store.getFacts('a')).toHaveLength(1);
    expect(store.getFacts('a')[0]?.content).toBe('FastAPI');
    expect(store.getFacts('b')[0]?.content).toBe('Django');
  });

  it('evicts oldest-accessed facts beyond the cap', () => {
    const store = makeStore({ maxFacts: 3 });
    store.addFact({ key: 'f1', content: 'one', instance: 'dev', source: 'user', tags: [] });
    store.addFact({ key: 'f2', content: 'two', instance: 'dev', source: 'user', tags: [] });
    store.addFact({ key: 'f3', content: 'three', instance: 'dev', source: 'user', tags: [] });
    // Touch f1 so it is most recent, then overflow the cap.
    store.searchFacts('one', 'dev');
    store.addFact({ key: 'f4', content: 'four', instance: 'dev', source: 'user', tags: [] });

    const facts = store.getFacts('dev');
    expect(facts).toHaveLength(3);
    expect(facts.map((f) => f.key)).not.toContain('f2'); // oldest, evicted
    expect(facts.map((f) => f.key)).toContain('f1');
    expect(facts.map((f) => f.key)).toContain('f4');
  });

  it('enforces the default facts cap of 100', () => {
    const store = makeStore();
    for (let i = 0; i < MEMORY_LIMITS.facts + 10; i++) {
      store.addFact({ key: `f${i}`, content: `fact ${i}`, instance: 'dev', source: 'auto', tags: [] });
    }
    expect(store.getStats().facts).toBe(MEMORY_LIMITS.facts);
  });

  it('caps decisions and preferences to their limits', () => {
    const store = makeStore({ maxDecisions: 5, maxPreferences: 3 });
    for (let i = 0; i < 8; i++) {
      store.addDecision({ key: `d${i}`, content: `decision ${i}`, instance: 'dev' });
    }
    for (let i = 0; i < 5; i++) {
      store.addPreference({ key: `p${i}`, content: `pref ${i}`, instance: 'dev' });
    }
    expect(store.getDecisions('dev')).toHaveLength(5);
    expect(store.getPreferences('dev')).toHaveLength(3);
  });

  it('persists to disk on flush and reloads on a fresh store', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    tempDirs.push(dataDir);
    const store = new MemoryStore({ dataDir });
    store.addFact({ key: 'stack', content: 'FastAPI', instance: 'dev', source: 'user', tags: [] });
    store.addConversation({
      sessionId: 's1',
      instance: 'dev',
      role: 'user',
      content: 'hello',
    });
    store.flush();

    const file = readFileSync(join(dataDir, 'memory-store.json'), 'utf8');
    expect(file).toContain('FastAPI');

    const reloaded = new MemoryStore({ dataDir });
    expect(reloaded.getFacts('dev')).toHaveLength(1);
    expect(reloaded.getConversations('s1')).toHaveLength(1);
  });

  it('rehydrates: seed a snapshot then recall it from a fresh store', () => {
    const store = makeStore();
    store.addFact({ key: 'deadline', content: 'Oct 1', instance: 'dev', source: 'user', tags: [] });
    store.setPlan({ summary: 'Migrate auth', steps: ['JWT', 'SSO'], updatedAt: '2026-01-01T00:00:00.000Z' });
    const snapshot = store.snapshot();

    const fresh = makeStore();
    fresh.seed(snapshot);
    const recalled = fresh.searchFacts('deadline', 'dev');
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.content).toBe('Oct 1');
    expect(fresh.getPlan()?.summary).toBe('Migrate auth');
  });

  it('clear wipes everything', () => {
    const store = makeStore();
    store.addFact({ key: 'k', content: 'v', instance: 'dev', source: 'user', tags: [] });
    store.clear();
    expect(store.getFacts('dev')).toHaveLength(0);
    expect(store.getStats().conversations).toBe(0);
  });

  it('searchFacts matches content, key and tags case-insensitively', () => {
    const store = makeStore();
    store.addFact({
      key: 'stack',
      content: 'FastAPI + PostgreSQL',
      instance: 'dev',
      source: 'user',
      tags: ['python', 'backend'],
    });
    expect(store.searchFacts('postgresql', 'dev')).toHaveLength(1);
    expect(store.searchFacts('STACK', 'dev')).toHaveLength(1);
    expect(store.searchFacts('backend', 'dev')).toHaveLength(1);
    expect(store.searchFacts('nope', 'dev')).toHaveLength(0);
  });

  it('close() synchronously flushes pending debounced writes', () => {
    const store = makeStore({ saveDebounceMs: 60_000 });
    store.addFact({ key: 'flush_me', content: 'durable content', instance: 'dev', source: 'user', tags: [] });

    store.close();

    const file = readFileSync(join(store.dataDir, 'memory-store.json'), 'utf8');
    expect(file).toContain('durable content');
  });

  it('close() is idempotent and clears the debounce timer', () => {
    vi.useFakeTimers();
    try {
      const store = makeStore({ saveDebounceMs: 60_000 });
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      store.addFact({ key: 'timer', content: 'timed content', instance: 'dev', source: 'user', tags: [] });
      const scheduled = setTimeoutSpy.mock.results[0]?.value;

      const clearSpy = vi.spyOn(global, 'clearTimeout');
      store.close();
      store.close();

      expect(clearSpy).toHaveBeenCalledWith(scheduled);
      expect(() => vi.runAllTimers()).not.toThrow();
      const file = readFileSync(join(store.dataDir, 'memory-store.json'), 'utf8');
      expect(file).toContain('timed content');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('registerShutdownHooks wires process signals to close()', () => {
    const store = makeStore({ saveDebounceMs: 60_000 });
    store.addFact({ key: 'hook', content: 'hooked content', instance: 'dev', source: 'user', tags: [] });

    const onSpy = vi.spyOn(process, 'on');
    const before = process.listenerCount('SIGTERM');
    const unsubscribe = store.registerShutdownHooks(['SIGINT', 'SIGTERM']);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    const call = onSpy.mock.calls.find(([event]) => event === 'SIGTERM');
    expect(call).toBeDefined();
    const handler = call?.[1] as () => void;
    handler();

    const file = readFileSync(join(store.dataDir, 'memory-store.json'), 'utf8');
    expect(file).toContain('hooked content');

    unsubscribe();
    expect(process.listenerCount('SIGTERM')).toBe(before);
    onSpy.mockRestore();
  });
});
