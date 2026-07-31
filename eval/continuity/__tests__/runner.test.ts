import { describe, expect, it } from 'vitest';
import { PROJECT_ONBOARDING } from '../fixtures/continuity-scenarios.js';
import { detectGoldfish } from '../lib/goldfish-detector.js';
import { PASS_RATE, runMatrix, runScenario } from '../lib/runner.js';
import type { ChatSUT } from '../lib/sut.js';
import { GoldfishSUT, ScriptedMemorySUT } from '../lib/sut.js';

describe('runScenario', () => {
  it('a scripted memory SUT passes with zero goldfish turns', async () => {
    const sut = new ScriptedMemorySUT(PROJECT_ONBOARDING);
    const outcome = await runScenario(sut, PROJECT_ONBOARDING, 0);
    expect(outcome.passed).toBe(true);
    expect(outcome.goldfishTurns).toEqual([]);
    expect(outcome.turnOutcomes).toHaveLength(PROJECT_ONBOARDING.totalTurns);
  });

  it('seeding turns are not checked, later turns are', async () => {
    const sut = new ScriptedMemorySUT(PROJECT_ONBOARDING);
    const outcome = await runScenario(sut, PROJECT_ONBOARDING, 0);
    const checked = outcome.turnOutcomes.filter((t) => t.checked);
    expect(checked.length).toBe(PROJECT_ONBOARDING.totalTurns - PROJECT_ONBOARDING.seedTurns);
  });

  it('a goldfish SUT fails with goldfish turns recorded', async () => {
    const sut = new GoldfishSUT();
    const outcome = await runScenario(sut, PROJECT_ONBOARDING, 0);
    expect(outcome.passed).toBe(false);
    expect(outcome.goldfishTurns.length).toBeGreaterThan(0);
  });

  it('kills the pod at the requested turns', async () => {
    let kills = 0;
    const trackingSut: ChatSUT = {
      name: 'tracking',
      ask: async () => 'a clean reply',
      kill: async () => {
        kills += 1;
      },
      reset: async () => {},
    };
    await runScenario(trackingSut, PROJECT_ONBOARDING, 0, [3, 5, 7]);
    expect(kills).toBe(3);
  });
});

describe('runMatrix + scoring', () => {
  it('passes when every run is clean', async () => {
    const sut = new ScriptedMemorySUT(PROJECT_ONBOARDING);
    const summary = await runMatrix(sut, PROJECT_ONBOARDING, 3);
    expect(summary.passedRuns).toBe(3);
    expect(summary.passRate).toBe(1);
    expect(summary.passed).toBe(true);
  });

  it('fails when fewer than the pass-rate threshold of runs pass', async () => {
    let runsCompleted = 0;
    const runsToFail = 2;
    const mostlyGoldfish: ChatSUT = {
      name: 'mostly-goldfish',
      ask: async () => {
        if (runsCompleted <= runsToFail) {
          return 'What do you mean? Could you explain again?';
        }
        return 'FastAPI.';
      },
      kill: async () => {},
      reset: async () => {
        runsCompleted += 1;
      },
    };
    const summary = await runMatrix(mostlyGoldfish, PROJECT_ONBOARDING, 10);
    expect(summary.passedRuns).toBe(8);
    expect(summary.passRate).toBe(0.8);
    expect(summary.passRate).toBeLessThan(PASS_RATE);
    expect(summary.passed).toBe(false);
  });

  it('passes at exactly the threshold (9/10)', async () => {
    let runsCompleted = 0;
    const runsToFail = 1;
    const mostlyGood: ChatSUT = {
      name: 'mostly-good',
      ask: async () => {
        if (runsCompleted <= runsToFail) {
          return 'I lost the context.';
        }
        return 'FastAPI.';
      },
      kill: async () => {},
      reset: async () => {
        runsCompleted += 1;
      },
    };
    const summary = await runMatrix(mostlyGood, PROJECT_ONBOARDING, 10);
    expect(summary.passedRuns).toBe(9);
    expect(summary.passRate).toBe(PASS_RATE);
    expect(summary.passed).toBe(true);
  });

  it('detects goldfish per turn even when one turn fails', async () => {
    let turn = 0;
    const oneGoldfishTurn: ChatSUT = {
      name: 'one-goldfish-turn',
      ask: async () => {
        turn += 1;
        // Turn 6 (checked) is goldfish; everything else is clean.
        return turn === 6 ? 'Remind me what we discussed.' : 'Clean reply referencing the plan.';
      },
      kill: async () => {},
      reset: async () => {
        turn = 0;
      },
    };
    const outcome = await runScenario(oneGoldfishTurn, PROJECT_ONBOARDING, 0);
    expect(outcome.passed).toBe(false);
    expect(outcome.goldfishTurns).toEqual([6]);
  });

  it('the detector agrees with the goldfish SUT output', async () => {
    const sut = new GoldfishSUT();
    const reply = await sut.ask('anything');
    expect(detectGoldfish(reply).isGoldfish).toBe(true);
  });
});
