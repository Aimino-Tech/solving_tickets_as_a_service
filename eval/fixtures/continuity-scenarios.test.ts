import { describe, expect, it } from 'vitest';
import { SCENARIOS, referencesSeed } from './continuity-scenarios.js';
import { ruleBasedExtractor, applyMemoryDelta, emptyMemory } from '../../src/chat/memory.js';

describe('continuity-scenarios fixtures', () => {
  it('defines at least 3 scenarios', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3);
  });

  it('each scenario has exactly 10 turns with distinct ids', () => {
    const ids = new Set<string>();
    for (const s of SCENARIOS) {
      expect(s.turns.length, `${s.id} should have 10 turns`).toBe(10);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.seedValues.length).toBeGreaterThanOrEqual(3);
      for (const t of s.turns) expect(typeof t).toBe('string');
    }
  });

  it('turns 1-3 seed memory via ruleBasedExtractor', () => {
    for (const s of SCENARIOS) {
      let mem = emptyMemory();
      for (let i = 0; i < 3; i++) {
        const delta = ruleBasedExtractor(mem, s.turns[i], '');
        mem = applyMemoryDelta(mem, delta);
      }
      expect(mem.facts.length + mem.decisions.length + (mem.plan ? 1 : 0) + Object.keys(mem.preferences).length, `${s.id} should seed memory`).toBeGreaterThanOrEqual(3);
    }
  });

  it('turns 4-10 genuinely reference turns 1-3 (lint)', () => {
    for (const s of SCENARIOS) {
      for (let i = 3; i < s.turns.length; i++) {
        const ok = referencesSeed(s.turns[i], s.seedValues);
        expect(ok, `${s.id} turn ${i + 1} must reference a seeded value: "${s.turns[i]}"`).toBe(true);
      }
    }
  });

  it('seed values are distinctive (not single common words)', () => {
    for (const s of SCENARIOS) {
      for (const v of s.seedValues) {
        expect(v.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
