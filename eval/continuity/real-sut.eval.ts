/**
 * Real-SUT continuity driver — 10 live conversations x 10 turns each.
 *
 * Runs the continuity scenarios against a REAL opencode-serve instance
 * (the same server the AIM-4442 gateway drives), one fresh session per run.
 *
 * Gate is strict: every run must complete (no transport/model errors) and
 * every run must be goldfish-free. Exit code 1 unless 10/10 x 10/10 is green.
 *
 * Env:
 *   REAL_SUT_SCENARIO  scenario id (default project-onboarding)
 *   REAL_SUT_RUNS      number of conversations (default 10)
 *   OPENCODE_URL       opencode serve base URL (default http://127.0.0.1:20888)
 *   OPENCODE_API_KEY   auth key (default: process env)
 */
import { getScenario } from './fixtures/continuity-scenarios.js';
import { RealSUT } from './lib/real-sut.js';
import type { HarnessSummary, RunOutcome } from './lib/runner.js';
import { PASS_RATE, runScenario } from './lib/runner.js';
import { buildReport, printSummary, writeReport } from './report.js';

const SCENARIO_ID = process.env.REAL_SUT_SCENARIO ?? 'project-onboarding';
const RUNS = parseRuns(process.env.REAL_SUT_RUNS);
const BASE_URL = process.env.OPENCODE_URL ?? 'http://127.0.0.1:20888';

function parseRuns(raw: string | undefined): number {
  const parsed = Number(raw);
  if (raw === undefined || !Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const scenario = getScenario(SCENARIO_ID);
  const sut = new RealSUT({ baseUrl: BASE_URL });
  const runs: RunOutcome[] = [];
  const runErrors: Array<{ run: number; message: string }> = [];

  console.log(`real SUT: ${sut.name} | scenario ${scenario.id} | ${RUNS} conversations x ${scenario.totalTurns} turns`);

  for (let i = 0; i < RUNS; i += 1) {
    try {
      const outcome = await runScenario(sut, scenario, i);
      runs.push(outcome);
      console.log(
        `  run ${i + 1}/${RUNS}: ${outcome.passed ? 'PASS' : `FAIL goldfish@${outcome.goldfishTurns.join(',')}`} (${outcome.turnOutcomes.length} turns)`,
      );
    } catch (err) {
      runErrors.push({ run: i + 1, message: err instanceof Error ? err.message : String(err) });
      console.error(`  run ${i + 1}/${RUNS}: ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const passedRuns = runs.filter((run) => run.passed).length;
  const passRate = runs.length === 0 ? 0 : passedRuns / runs.length;
  const summary: HarnessSummary = {
    scenarioId: scenario.id,
    sutName: sut.name,
    numRuns: RUNS,
    passedRuns,
    passRate,
    passed: passRate >= PASS_RATE,
    runs,
  };

  const report = buildReport(
    `continuity (real SUT ${sut.name}, scenario ${scenario.id}, N=${RUNS}, ${scenario.totalTurns} turns/run)`,
    [summary],
  );
  printSummary(report);
  const reportPath = await writeReport(report, 'real-sut');
  console.log(`Report written to ${reportPath}`);

  for (const error of runErrors) {
    console.error(`  run ${error.run}: ${error.message}`);
  }

  const allGreen = runErrors.length === 0 && passedRuns === RUNS;
  if (!allGreen) {
    console.error(
      `FAIL: ${runErrors.length} errored runs, ${RUNS - passedRuns} goldfish runs (need ${RUNS}/${RUNS} green).`,
    );
    process.exitCode = 1;
  } else {
    console.log(`OK: ${RUNS} conversations x ${scenario.totalTurns} turns, zero goldfish, zero errors.`);
  }
}

main().catch((err: unknown) => {
  console.error(`real-sut eval crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
