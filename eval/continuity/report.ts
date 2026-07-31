/**
 * Report writer for the continuity harness (AIM-4445).
 *
 * Writes a JSON report and a human-readable markdown report into
 * eval/continuity/results/ (gitignored) and prints a one-line summary per
 * scenario to stdout.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessSummary } from './lib/runner.js';
import { summarize } from './lib/runner.js';

const RESULTS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'results');

export interface ContinuityReport {
  suite: string;
  createdAt: string;
  passRateThreshold: number;
  scenarios: HarnessSummary[];
  passed: boolean;
}

export function buildReport(suite: string, scenarios: HarnessSummary[]): ContinuityReport {
  return {
    suite,
    createdAt: new Date().toISOString(),
    passRateThreshold: 0.9,
    scenarios,
    passed: scenarios.every((s) => s.passed),
  };
}

export function renderMarkdown(report: ContinuityReport): string {
  const lines: string[] = [`# Continuity eval: ${report.suite}`, ''];
  lines.push(`- Created: ${report.createdAt}`);
  lines.push(`- Pass threshold: >= ${report.passRateThreshold * 100}% of runs per scenario`);
  lines.push(`- Overall: ${report.passed ? 'PASS' : 'FAIL'}`, '');
  lines.push('| Scenario | SUT | Runs passed | Pass rate | Result |', '|---|---|---|---|---|');
  for (const s of report.scenarios) {
    lines.push(
      `| ${s.scenarioId} | ${s.sutName} | ${s.passedRuns}/${s.numRuns} | ${(s.passRate * 100).toFixed(0)}% | ${s.passed ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('');
  for (const s of report.scenarios) {
    for (const run of s.runs.filter((r) => !r.passed)) {
      lines.push(`Run ${run.runIndex} of ${s.scenarioId} failed on turns: ${run.goldfishTurns.join(', ') || 'none'}`);
    }
  }
  return lines.join('\n');
}

export async function writeReport(report: ContinuityReport, filename = 'report'): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const jsonPath = join(RESULTS_DIR, `${filename}.json`);
  const mdPath = join(RESULTS_DIR, `${filename}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, renderMarkdown(report), 'utf8');
  return jsonPath;
}

export function printSummary(report: ContinuityReport): void {
  for (const s of report.scenarios) {
    console.log(summarize(s));
  }
  console.log(`Overall: ${report.passed ? 'PASS' : 'FAIL'}`);
}
