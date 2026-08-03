import { describe, expect, it } from 'vitest';
import {
  applyMemoryDelta,
  emptyMemory,
  parseMemoryCommand,
  recallMemory,
  renderMemory,
  ruleBasedExtractor,
  seedMemoryBlock,
} from '../../chat/memory.js';

describe('agent memory (AIM-4443)', () => {
  it('extracts facts, decisions, plan, and preferences from a turn', () => {
    const prev = emptyMemory('2026-01-01T00:00:00.000Z');
    const user = 'my name is Alice. We are building syntaro-cli. I prefer concise answers.';
    const assistant =
      'Plan: scaffold the CLI, then wire auth. Let us decide we will go with Node 20. About pricing: free tier first.';
    const delta = ruleBasedExtractor(prev, user, assistant);
    const next = applyMemoryDelta(prev, delta);

    const factKeys = next.facts.map((f) => f.key);
    expect(factKeys).toContain('user_name');
    expect(factKeys).toContain('project');
    expect(next.preferences.style).toContain('concise');
    expect(next.plan?.goal).toBeTruthy();
    expect(next.decisions.length).toBeGreaterThan(0);
  });

  it('never re-inserts an already-known fact key', () => {
    const prev = emptyMemory();
    prev.facts.push({ key: 'project', value: 'syntaro', updatedAt: prev.updatedAt });
    const delta = ruleBasedExtractor(prev, 'the project is syntaro again', '');
    const next = applyMemoryDelta(prev, delta);
    expect(next.facts.filter((f) => f.key === 'project')).toHaveLength(1);
    expect(next.facts.find((f) => f.key === 'project')?.value).toBe('syntaro');
  });

  it('enforces caps on facts and preferences', () => {
    let prev = emptyMemory();
    for (let i = 0; i < 150; i += 1) {
      prev = applyMemoryDelta(prev, {
        facts: [{ key: `fact_${i}`, value: `value ${i}`, updatedAt: prev.updatedAt }],
      });
    }
    expect(prev.facts.length).toBeLessThanOrEqual(100);
  });

  it('recallMemory matches keywords and renderMemory is non-empty', () => {
    const mem = emptyMemory();
    mem.facts.push({ key: 'project', value: 'syntaro', updatedAt: mem.updatedAt });
    const hits = recallMemory(mem, 'syntaro');
    expect(hits.length).toBeGreaterThan(0);
    expect(renderMemory(mem)).toContain('syntaro');
  });

  it('seeds a memory block only when there is something to seed', () => {
    expect(seedMemoryBlock(emptyMemory())).toBe('');
    const mem = emptyMemory();
    mem.facts.push({ key: 'project', value: 'syntaro', updatedAt: mem.updatedAt });
    expect(seedMemoryBlock(mem)).toContain('[Memory]');
  });

  it('parses /memory and /memory recall commands', () => {
    expect(parseMemoryCommand('/memory')).toEqual({ type: 'memory' });
    expect(parseMemoryCommand('/memory recall project')).toEqual({ type: 'recall', query: 'project' });
    expect(parseMemoryCommand('hello')).toEqual({ type: 'none' });
  });
});
