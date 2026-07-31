/**
 * Rehydrate eval variant (AIM-4445) - pod-death continuity.
 *
 * Simulates the crash window: the pod is killed (kill -9) at fixed points
 * mid-conversation and the conversation resumes. With the scripted SUT the
 * kill is a no-op (scripted memory cannot be lost), which is exactly the
 * contract AIM-4442/4443 must deliver for the real SUT: after pod death +
 * rehydration from the session store, the agent continues with full context
 * and never asks the user to re-explain.
 *
 * Usage:
 *   npx tsx eval/continuity/rehydrate.eval.ts
 */
import { getScenario } from './fixtures/continuity-scenarios.js';
import { DEFAULT_RUNS, runMatrix } from './lib/runner.js';
import { ScriptedMemorySUT } from './lib/sut.js';
import { buildReport, printSummary, writeReport } from './report.js';

// Kill the pod after these turns (3 kills per run, mid-conversation).
const KILL_AFTER_TURNS = [3, 5, 7];

async function main(): Promise<void> {
  const scenario = getScenario('project-onboarding');
  const sut = new ScriptedMemorySUT(scenario);
  const summary = await runMatrix(sut, scenario, DEFAULT_RUNS, KILL_AFTER_TURNS);

  const report = buildReport(`rehydrate (scripted SUT, kills after turns ${KILL_AFTER_TURNS.join(', ')})`, [summary]);
  printSummary(report);
  const path = await writeReport(report, 'rehydrate');
  console.log(`Report written to ${path}`);

  if (!report.passed) {
    console.error('FAIL: conversation did not survive pod kills.');
    process.exitCode = 1;
  } else {
    console.log('OK: conversation survives pod kills with zero goldfish turns.');
  }
}

void main();
