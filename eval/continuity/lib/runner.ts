/**
 * Continuity run matrix + scoring (AIM-4445).
 *
 * Per the eval spec the harness must "run 10x, with 10 follow-up messages
 * first, without talking to a gold fish": N runs, each a full conversation
 * of `totalTurns` messages, where every turn after the seeding prefix must
 * be goldfish-free. A run passes with ZERO goldfish turns; the scenario
 * passes when >= PASS_RATE of runs pass.
 */
import type { ContinuityScenario } from '../fixtures/continuity-scenarios.js';
import type { GoldfishDetection } from './goldfish-detector.js';
import { detectGoldfish } from './goldfish-detector.js';
import type { ChatSUT } from './sut.js';

export const DEFAULT_RUNS = 10;
export const PASS_RATE = 0.9;

export interface TurnOutcome {
  turn: number;
  userMessage: string;
  assistantReply: string;
  checked: boolean;
  detection: GoldfishDetection;
}

export interface RunOutcome {
  scenarioId: string;
  runIndex: number;
  passed: boolean;
  goldfishTurns: number[];
  turnOutcomes: TurnOutcome[];
}

export interface HarnessSummary {
  scenarioId: string;
  sutName: string;
  numRuns: number;
  passedRuns: number;
  passRate: number;
  passed: boolean;
  runs: RunOutcome[];
}

/** Run one full conversation (all turns of the scenario) against the SUT. */
export async function runScenario(
  sut: ChatSUT,
  scenario: ContinuityScenario,
  runIndex: number,
  killAfterTurns: number[] = [],
): Promise<RunOutcome> {
  await sut.reset();
  const turnOutcomes: TurnOutcome[] = [];
  const goldfishTurns: number[] = [];

  for (const turn of scenario.turns) {
    const reply = await sut.ask(turn.user);
    const checked = turn.turn > scenario.seedTurns;
    const detection = checked ? detectGoldfish(reply) : { isGoldfish: false, reasons: [] as string[] };
    if (checked && detection.isGoldfish) {
      goldfishTurns.push(turn.turn);
    }
    turnOutcomes.push({ turn: turn.turn, userMessage: turn.user, assistantReply: reply, checked, detection });
    if (killAfterTurns.includes(turn.turn)) {
      await sut.kill();
    }
  }

  return {
    scenarioId: scenario.id,
    runIndex,
    passed: goldfishTurns.length === 0,
    goldfishTurns,
    turnOutcomes,
  };
}

/** Run N conversations and summarize pass rate. */
export async function runMatrix(
  sut: ChatSUT,
  scenario: ContinuityScenario,
  numRuns = DEFAULT_RUNS,
  killAfterTurns: number[] = [],
): Promise<HarnessSummary> {
  const runs: RunOutcome[] = [];
  for (let i = 0; i < numRuns; i += 1) {
    runs.push(await runScenario(sut, scenario, i, killAfterTurns));
  }
  const passedRuns = runs.filter((r) => r.passed).length;
  const passRate = runs.length === 0 ? 0 : passedRuns / runs.length;
  return {
    scenarioId: scenario.id,
    sutName: sut.name,
    numRuns,
    passedRuns,
    passRate,
    passed: passRate >= PASS_RATE,
    runs,
  };
}

/** Compact one-line summary of a scenario matrix. */
export function summarize(summary: HarnessSummary): string {
  return [
    `${summary.scenarioId} [${summary.sutName}]`,
    `${summary.passedRuns}/${summary.numRuns} runs passed`,
    `pass rate ${(summary.passRate * 100).toFixed(0)}%`,
    summary.passed ? 'PASS' : 'FAIL',
  ].join(' - ');
}
