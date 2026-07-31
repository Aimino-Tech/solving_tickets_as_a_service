/**
 * Continuity eval driver (AIM-4445) - "run 10x, with 10 follow-up messages
 * first, without talking to a gold fish".
 *
 * Runs every scenario N=10 times with the scripted (perfect-memory) SUT and
 * asserts the goldfish baseline FAILS, proving the harness can tell memory
 * apart from no memory. Exits non-zero when any scenario fails.
 *
 * Usage:
 *   npx tsx eval/continuity/continuity.eval.ts
 */
import { ALL_SCENARIOS } from './fixtures/continuity-scenarios.js';
import { DEFAULT_RUNS, runMatrix } from './lib/runner.js';
import { GoldfishSUT, ScriptedMemorySUT } from './lib/sut.js';
import { buildReport, printSummary, writeReport } from './report.js';

async function main(): Promise<void> {
  const memorySummaries = [];
  for (const scenario of ALL_SCENARIOS) {
    const sut = new ScriptedMemorySUT(scenario);
    memorySummaries.push(await runMatrix(sut, scenario, DEFAULT_RUNS));
  }

  // Baseline: the no-memory SUT must FAIL every scenario. If it passes, the
  // harness cannot distinguish memory from no memory and is itself broken.
  let baselineFails = true;
  for (const scenario of ALL_SCENARIOS) {
    const goldfishSummary = await runMatrix(new GoldfishSUT(), scenario, DEFAULT_RUNS);
    if (goldfishSummary.passed) {
      baselineFails = false;
    }
  }

  const report = buildReport('continuity (scripted SUT, N=10)', memorySummaries);
  printSummary(report);
  const path = await writeReport(report);
  console.log(`Report written to ${path}`);

  if (!report.passed || !baselineFails) {
    console.error('FAIL: continuity harness gate did not hold (scenario failure or baseline not failing).');
    process.exitCode = 1;
  } else {
    console.log('OK: all scenarios pass with a memory-ful SUT; goldfish baseline fails as expected.');
  }
}

void main();
