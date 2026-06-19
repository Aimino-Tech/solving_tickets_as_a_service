#!/usr/bin/env node
/**
 * Eval Regression Checker
 *
 * Compares current promptfoo eval results against a baseline JSON file
 * and exits with code 1 if the pass rate drops by more than the threshold.
 *
 * Usage:
 *   node eval/scripts/check-regression.mjs \
 *     --baseline eval/baselines/smoke.json \
 *     --current eval/results/smoke-<sha>.json \
 *     --threshold 0.05
 *
 * Exit codes:
 *   0 — Pass rate within threshold
 *   1 — Pass rate dropped beyond threshold, or error
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

// ── CLI args ────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    baseline:  { type: 'string', short: 'b' },
    current:   { type: 'string', short: 'c' },
    threshold: { type: 'string', short: 't', default: '0.05' },
    help:      { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
});

if (args.help || !args.baseline || !args.current) {
  console.error(`
Usage: node eval/scripts/check-regression.mjs \\
  --baseline <path>   Path to baseline JSON file
  --current  <path>   Path to current results JSON file
  --threshold <float> Maximum allowed pass rate drop (default: 0.05)

Exit codes:
  0 — Pass rate within threshold
  1 — Pass rate dropped beyond threshold, or error occurred
`);
  process.exit(args.help ? 0 : 1);
}

const THRESHOLD = parseFloat(args.threshold);
if (Number.isNaN(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1) {
  console.error(`[ERROR] Invalid threshold "${args.threshold}". Must be a float between 0 and 1.`);
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const CYAN    = '\x1b[36m';
const BOLD    = '\x1b[1m';
const RESET   = '\x1b[0m';

function ok(msg) {
  console.log(`${GREEN}  [PASS]${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`${YELLOW}  [WARN]${RESET} ${msg}`);
}

function fail(msg) {
  console.log(`${RED}  [FAIL]${RESET} ${msg}`);
}

function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    console.error(`[ERROR] Cannot read file: ${path}`);
    console.error(`        ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[ERROR] Invalid JSON in file: ${path}`);
    console.error(`        ${err.message}`);
    process.exit(1);
  }
}

/**
 * Extract pass rate from promptfoo results JSON.
 *
 * promptfoo output can have multiple shapes:
 *   1. { results: [...], stats: { successes, failures, successRate } }
 *   2. { promptfoo: { results: [...], stats: { ... } } }
 *   3. { results: [...], summary: { passCount, failCount, passRate } }
 *   4. Top-level { passRate } (simplified baseline)
 *
 * Returns an object { passRate, totalTests, passedTests, failedTests }.
 */
function extractPassRate(data) {
  // Walk into common wrapper keys
  const root = data.promptfoo || data;

  // Shape 4: explicit passRate at top level (baseline / simplified)
  if (root.passRate !== undefined && root.totalTests !== undefined) {
    return {
      passRate: root.passRate,
      totalTests: root.totalTests,
      passedTests: root.passedTests ?? Math.round(root.passRate * root.totalTests),
      failedTests: root.failedTests ?? root.totalTests - Math.round(root.passRate * root.totalTests),
    };
  }

  // Shape 1 & 2: stats block
  if (root.stats) {
    const s = root.stats;
    const totalTests = (s.successes ?? 0) + (s.failures ?? 0) + (s.errors ?? 0);
    const passedTests = s.successes ?? 0;
    const failedTests = (s.failures ?? 0) + (s.errors ?? 0);
    const passRate = totalTests > 0 ? s.successRate ?? (passedTests / totalTests) : 0;
    return { passRate, totalTests, passedTests, failedTests };
  }

  // Shape 3: summary block
  if (root.summary) {
    const s = root.summary;
    const totalTests = (s.passCount ?? 0) + (s.failCount ?? 0);
    const passedTests = s.passCount ?? 0;
    const failedTests = s.failCount ?? 0;
    const passRate = totalTests > 0 ? s.passRate ?? (passedTests / totalTests) : 0;
    return { passRate, totalTests, passedTests, failedTests };
  }

  // Fallback: compute from results array
  if (Array.isArray(root.results)) {
    const totalTests = root.results.length;
    const passedTests = root.results.filter(r => {
      // promptfoo marks success via `success`, `pass`, or `result.pass`
      return r.success === true || r.pass === true || r.result?.pass === true;
    }).length;
    const failedTests = totalTests - passedTests;
    const passRate = totalTests > 0 ? passedTests / totalTests : 0;
    return { passRate, totalTests, passedTests, failedTests };
  }

  // Last resort: fail
  console.error('[ERROR] Could not determine pass rate from results JSON.');
  console.error('        Expected one of: root.stats, root.summary, root.results[], or root.passRate');
  console.error(`        Root keys: ${Object.keys(root).join(', ')}`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`${BOLD}--- Eval Regression Check ---${RESET}\n`);

// 1. Read both files
const baselineData = readJson(args.baseline);
const currentData  = readJson(args.current);

// 2. Extract pass rates
const baseline = extractPassRate(baselineData);
const current  = extractPassRate(currentData);

console.log(`  Baseline:  ${(baseline.passRate * 100).toFixed(1)}% (${baseline.passedTests}/${baseline.totalTests})`);
console.log(`  Current:   ${(current.passRate * 100).toFixed(1)}% (${current.passedTests}/${current.totalTests})`);
console.log(`  Threshold: ${(THRESHOLD * 100).toFixed(1)}%\n`);

// 3. Compare
const drop = baseline.passRate - current.passRate;
const pctDrop = (drop * 100).toFixed(1);

if (current.totalTests === 0) {
  fail('No tests were executed in the current run.');
  process.exit(1);
}

if (drop > THRESHOLD) {
  fail(`Pass rate dropped by ${pctDrop}% (exceeds threshold of ${(THRESHOLD * 100).toFixed(1)}%)`);
  if (current.failedTests > 0) {
    console.error(`\n  Failed ${current.failedTests} test(s). Cross-check eval/results/smoke-*.json for details.`);
  }
  process.exit(1);
}

if (drop > 0) {
  warn(`Pass rate dropped by ${pctDrop}% (within allowed threshold of ${(THRESHOLD * 100).toFixed(1)}%)`);
} else if (drop < 0) {
  ok(`Pass rate improved by ${Math.abs(drop * 100).toFixed(1)}% — nice!`);
} else {
  ok('Pass rate unchanged.');
}

console.log('');
ok('Regression check passed.');
process.exit(0);
