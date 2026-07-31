/**
 * Fixture lint tests (AIM-4445).
 *
 * Verifies the scenario fixtures satisfy the eval contract:
 *   - scenarios parse and have a stable identity,
 *   - exactly 10 turns, numbered 1..10 in order,
 *   - turns 1..seedTurns actually establish the declared facts,
 *   - turns (seedTurns+1)..10 genuinely reference those facts again
 *     (fact coverage) and ground each reply in a seeded fact
 *     (fact-keyword check),
 *   - every referencing scripted reply is goldfish-free.
 */
import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS, getScenario } from '../fixtures/continuity-scenarios.js';
import { detectGoldfish } from '../lib/goldfish-detector.js';

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function containsFact(text: string, fact: string): boolean {
  return normalize(text).includes(normalize(fact));
}

describe('continuity scenario fixtures', () => {
  it('parse: every scenario round-trips through getScenario and ids are unique', () => {
    const ids = new Set<string>();
    for (const scenario of ALL_SCENARIOS) {
      expect(getScenario(scenario.id)).toBe(scenario);
      expect(scenario.description.length).toBeGreaterThan(0);
      expect(scenario.facts.length).toBeGreaterThan(0);
      expect(ids.has(scenario.id)).toBe(false);
      ids.add(scenario.id);
    }
  });

  it('have exactly 10 turns numbered 1..10 in order', () => {
    for (const scenario of ALL_SCENARIOS) {
      expect(scenario.totalTurns).toBe(10);
      expect(scenario.turns).toHaveLength(10);
      expect(scenario.turns.map((turn) => turn.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('seed the declared facts in turns 1..seedTurns', () => {
    for (const scenario of ALL_SCENARIOS) {
      const seedTurns = scenario.turns.filter((turn) => turn.turn <= scenario.seedTurns);
      const seedText = seedTurns.flatMap((turn) => [turn.user, turn.scriptedReply]).join(' ');
      for (const fact of scenario.facts) {
        expect(containsFact(seedText, fact), `${scenario.id} should seed "${fact}"`).toBe(true);
      }
    }
  });

  it('reference every seeded fact somewhere in the follow-up turns (nothing orphaned)', () => {
    for (const scenario of ALL_SCENARIOS) {
      const followUps = scenario.turns.filter((turn) => turn.turn > scenario.seedTurns);
      const followUpText = followUps.flatMap((turn) => [turn.user, turn.scriptedReply]).join(' ');
      for (const fact of scenario.facts) {
        expect(containsFact(followUpText, fact), `${scenario.id} should reference "${fact}" after seeding`).toBe(true);
      }
    }
  });

  it('ground every follow-up reply in a seeded fact (fact-keyword check)', () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const turn of scenario.turns) {
        if (turn.turn <= scenario.seedTurns) {
          continue;
        }
        const grounded = scenario.facts.some((fact) => containsFact(turn.scriptedReply, fact));
        expect(grounded, `${scenario.id} turn ${turn.turn} reply should use a seeded fact`).toBe(true);
      }
    }
  });

  it('keep every follow-up scripted reply goldfish-free', () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const turn of scenario.turns) {
        if (turn.turn <= scenario.seedTurns) {
          continue;
        }
        const result = detectGoldfish(turn.scriptedReply);
        expect(result.isGoldfish, `${scenario.id} turn ${turn.turn} reply is goldfish`).toBe(false);
      }
    }
  });
});
