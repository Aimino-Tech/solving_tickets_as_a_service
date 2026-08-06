/**
 * SYNTARO Evaluation Scorecard — aggregates eval/conversations results into
 * metrics + trend + regression detection (the "Metrics/Rubrics" pillar).
 *
 * Usage:
 *   npx tsx eval/scorecard.ts              # all reports, latest first
 *   npx tsx eval/scorecard.ts --json       # machine-readable output
 *   npx tsx eval/scorecard.ts --since 2026-08-01
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TurnResult {
  index: number;
  user: string;
  reply: string;
  actions: { type: string; ticketTitle?: string; ticketNumber?: number }[];
  expectation: { action?: string };
  verdict: 'pass' | 'fail';
  errors?: string[];
}

interface EvalReport {
  runId: string;
  timestamp: string;
  repo: string;
  conversations: { id: number; name: string; turns: TurnResult[]; passed: number; failed: number }[];
  totals: { conversations: number; turns: number; passed: number; failed: number; passRate: number };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(__dirname, 'results', 'conversations');
const jsonFlag = process.argv.includes('--json');
const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx > -1 ? process.argv[sinceIdx + 1] : undefined;

function loadReports(): EvalReport[] {
  const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  const reports: EvalReport[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(resultsDir, f), 'utf8');
      const report = JSON.parse(raw) as EvalReport;
      if (since && report.timestamp.slice(0, 10) < since) continue;
      reports.push(report);
    } catch {
      // skip malformed reports
    }
  }
  reports.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return reports;
}

function actionTypeStats(turns: TurnResult[]): Record<string, { count: number; pass: number }> {
  const stats: Record<string, { count: number; pass: number }> = {};
  for (const t of turns) {
    const seen = new Set<string>();
    for (const a of t.actions) {
      if (seen.has(a.type)) continue;
      seen.add(a.type);
      const s = (stats[a.type] ??= { count: 0, pass: 0 });
      s.count += 1;
      if (t.verdict === 'pass') s.pass += 1;
    }
  }
  return stats;
}

function formatRows(rows: string[][]): string {
  const widths = rows[0].map((_, ci) => Math.max(...rows.map((r) => (r[ci] ?? '').length)));
  return rows.map((r) => r.map((c, ci) => c.padEnd(widths[ci])).join('  ')).join('\n');
}

const reports = loadReports();
if (reports.length === 0) {
  console.log('No eval reports found in eval/results/conversations/');
  process.exit(1);
}

if (jsonFlag) {
  const summary = reports.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    turns: r.totals.turns,
    passed: r.totals.passed,
    failed: r.totals.failed,
    passRate: r.totals.passRate,
    scenarios: r.conversations.map((c) => ({ name: c.name, passRate: c.passed / Math.max(1, c.passed + c.failed) })),
  }));
  console.log(JSON.stringify({ reports: summary }, null, 2));
  process.exit(0);
}

const latest = reports[0];
const prev = reports[1];

console.log('=== SYNTARO Eval Scorecard ===');
const repoLabel = typeof latest.repo === 'string' ? latest.repo : JSON.stringify(latest.repo ?? '');
console.log(`reports: ${reports.length}  latest: ${latest.runId} (${latest.timestamp})  repo: ${repoLabel}`);
console.log('');

// 1. Latest run summary
console.log(`--- Latest run: ${latest.totals.passed}/${latest.totals.turns} turns passed (${(latest.totals.passRate * 100).toFixed(1)}%) ---`);
const scenarioRows = [['scenario', 'passed', 'failed', 'rate']];
for (const c of latest.conversations) {
  const total = c.passed + c.failed;
  scenarioRows.push([c.name, String(c.passed), String(c.failed), `${((c.passed / total) * 100).toFixed(0)}%`]);
}
console.log(formatRows(scenarioRows));
console.log('');

// 2. Action-type accuracy (rubric: how accurately the agent performs each capability)
const actionStats = actionTypeStats(latest.conversations.flatMap((c) => c.turns));
console.log('--- Capability accuracy (by action type) ---');
const actionRows = [['action', 'count', 'pass', 'accuracy']];
for (const [type, s] of Object.entries(actionStats).sort((a, b) => b[1].count - a[1].count)) {
  actionRows.push([type, String(s.count), String(s.pass), `${((s.pass / s.count) * 100).toFixed(0)}%`]);
}
console.log(formatRows(actionRows));
console.log('');

// 3. Trend + regression detection (feedback loop signal)
console.log('--- Trend (pass rate per run) ---');
for (const r of reports) {
  console.log(`  ${r.timestamp.slice(0, 19)}  ${r.runId}  ${(r.totals.passRate * 100).toFixed(1)}%  (${r.totals.passed}/${r.totals.turns})`);
}
if (prev && latest.totals.passRate < prev.totals.passRate) {
  console.log(`\n⚠ REGRESSION DETECTED: pass rate dropped from ${(prev.totals.passRate * 100).toFixed(1)}% to ${(latest.totals.passRate * 100).toFixed(1)}%`);
  const newFails = latest.conversations.flatMap((c) => c.turns.filter((t) => t.verdict === 'fail'));
  for (const f of newFails.slice(0, 10)) {
    console.log(`  - ${f.user.slice(0, 80)}`);
    if (f.errors?.length) console.log(`      errors: ${f.errors.join('; ').slice(0, 150)}`);
  }
} else {
  console.log('\n✓ No regression — pass rate stable or improving');
}
