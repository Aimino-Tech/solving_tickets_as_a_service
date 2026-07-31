/**
 * CI acceptance gate for the continuity harness (AIM-4445).
 *
 * Runs the full eval matrix (every scenario x N=10) against the scripted
 * memory SUT and asserts:
 *   1. every scenario PASSES with a memory-ful SUT (>= 9/10 runs, zero
 *      goldfish turns per passing run),
 *   2. the no-memory baseline (GoldfishSUT) FAILS every scenario.
 *
 * These are the acceptance criteria the real SUT (STAS gateway + session
 * store + agent memory) must meet once wired in: "run 10x, with 10
 * follow-up messages first, without talking to a gold fish".
 */
import { describe, expect, it } from 'vitest';
import { ALL_SCENARIOS } from '../fixtures/continuity-scenarios.js';
import { runMatrix } from '../lib/runner.js';
import { GoldfishSUT, ScriptedMemorySUT } from '../lib/sut.js';

describe('continuity acceptance gate (10x runs x 10 follow-ups, no goldfish)', () => {
  it('a memory-ful SUT passes every scenario', async () => {
    for (const scenario of ALL_SCENARIOS) {
      const sut = new ScriptedMemorySUT(scenario);
      const summary = await runMatrix(sut, scenario, 10);
      expect(summary.passed, `scenario ${scenario.id} should pass`).toBe(true);
      expect(summary.passRate).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('the no-memory baseline fails every scenario (harness can tell memory apart)', async () => {
    for (const scenario of ALL_SCENARIOS) {
      const summary = await runMatrix(new GoldfishSUT(), scenario, 10);
      expect(summary.passed, `scenario ${scenario.id} baseline should fail`).toBe(false);
    }
  });
});
