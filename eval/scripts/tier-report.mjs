#!/usr/bin/env node

// =============================================================================
// Per-Tier Eval Report (AIM-4622)
//
// Reads promptfoo eval result files and reports pass rate AND cost bucketed by
// difficulty tier (1-4 → variant low/medium/high/max). Optionally runs a
// regression check against a per-tier baseline (eval/baselines/tiers.json).
//
// Usage:
//   node eval/scripts/tier-report.mjs \
//     --input-dir eval/results \
//     --output eval/results/tier-report.json \
//     --baseline eval/baselines/tiers.json \
//     --threshold 0.05
//
// Exit codes:
//   0 — report written (regression within threshold, or no baseline given)
//   1 — a tier's pass rate dropped beyond the threshold
// =============================================================================

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VARIANTS = ['low', 'medium', 'high', 'max'];
const TIERS = [1, 2, 3, 4];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inputDir: 'eval/results',
    output: 'eval/results/tier-report.json',
    baseline: '',
    threshold: 0.05,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input-dir': opts.inputDir = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--baseline': opts.baseline = args[++i]; break;
      case '--threshold': opts.threshold = parseFloat(args[++i]); break;
      default: console.warn(`[tier-report] Ignoring unknown option: ${args[i]}`);
    }
  }
  return opts;
}

function loadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[tier-report] Failed to parse ${filePath}:`, err.message);
    return null;
  }
}

function collectResultFiles(inputDir) {
  if (!existsSync(inputDir)) return [];
  const excluded = new Set(['tier-report.json', 'aggregated.json', 'full-report.json']);
  return readdirSync(inputDir)
    .filter((f) => f.endsWith('.json') && !excluded.has(f))
    .map((f) => join(inputDir, f));
}

/**
 * Extract per-test { tier, variant, passed, costCents } from a promptfoo
 * result file. tier/variant/cost may live at result.output.* (this provider's
 * shape) or on the result row itself.
 */
function extractTieredResults(data) {
  const out = [];
  const results = Array.isArray(data?.results) ? data.results : [];
  for (const r of results) {
    const output = r?.output ?? {};
    const tier =
      Number(output.tier ?? r.tier) ||
      Number(output?.artifacts?.tier) ||
      0;
    const variant = String(output.variant ?? r.variant ?? '') || undefined;
    const passed = Boolean(r.pass ?? r.success ?? output?.passed ?? false);
    const costCents = Number(output.costCents ?? r.costCents ?? r.cost) || 0;
    out.push({ tier, variant, passed, costCents, name: r.name || r.description || 'unnamed' });
  }
  return out;
}

function emptyTierStats() {
  return { total: 0, passed: 0, failed: 0, passRate: 0, totalCostCents: 0, avgCostCents: 0, variant: '' };
}

function bucketByTier(entries) {
  const buckets = new Map();
  for (const tier of TIERS) buckets.set(tier, emptyTierStats());
  for (const e of entries) {
    const tier = e.tier;
    const bucket = buckets.get(tier);
    if (!bucket) continue;
    bucket.total += 1;
    bucket.passed += e.passed ? 1 : 0;
    bucket.failed += e.passed ? 0 : 1;
    bucket.totalCostCents += e.costCents;
    if (e.variant && !bucket.variant) bucket.variant = e.variant;
  }
  for (const bucket of buckets.values()) {
    bucket.passRate = bucket.total > 0 ? bucket.passed / bucket.total : 0;
    bucket.avgCostCents = bucket.total > 0 ? Math.round(bucket.totalCostCents / bucket.total) : 0;
  }
  return buckets;
}

function readBaseline(path) {
  if (!path) return null;
  if (!existsSync(path)) {
    console.warn(`[tier-report] Baseline not found: ${path} — skipping regression check`);
    return null;
  }
  return loadJson(path);
}

function checkRegression(buckets, baseline, threshold) {
  const failures = [];
  for (const tier of TIERS) {
    const current = buckets.get(tier);
    const target = baseline?.[String(tier)] ?? baseline?.[tier];
    if (!current || current.total === 0 || target?.baselinePassRate === undefined) continue;
    const drop = target.baselinePassRate - current.passRate;
    if (drop > threshold) {
      failures.push({ tier, baselinePassRate: target.baselinePassRate, currentPassRate: current.passRate, drop });
    }
  }
  return failures;
}

function main() {
  const opts = parseArgs();
  const files = collectResultFiles(opts.inputDir);
  if (files.length === 0) {
    console.error(`[tier-report] No result files found in ${opts.inputDir}`);
    process.exit(1);
  }

  const entries = [];
  for (const file of files) {
    const data = loadJson(file);
    if (!data) continue;
    entries.push(...extractTieredResults(data));
  }

  const buckets = bucketByTier(entries);
  const report = {
    summary: {
      total: entries.length,
      passed: entries.filter((e) => e.passed).length,
      passRate: entries.length > 0 ? entries.filter((e) => e.passed).length / entries.length : 0,
      totalCostCents: Math.round(entries.reduce((a, e) => a + e.costCents, 0)),
    },
    tiers: Object.fromEntries(
      [...buckets.entries()].map(([tier, stats]) => [
        tier,
        {
          variant: stats.variant || VARIANTS[tier - 1],
          ...stats,
        },
      ]),
    ),
    timestamp: new Date().toISOString(),
  };

  const dir = opts.output.substring(0, opts.output.lastIndexOf('/'));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[tier-report] ${report.summary.total} results; overall pass rate ${(report.summary.passRate * 100).toFixed(1)}%`);
  for (const tier of TIERS) {
    const s = report.tiers[tier];
    console.log(`  Tier ${tier} (${s.variant}): ${(s.passRate * 100).toFixed(1)}% pass, avg $${(s.avgCostCents / 100).toFixed(2)}/fix`);
  }

  const baseline = readBaseline(opts.baseline);
  if (baseline) {
    const failures = checkRegression(buckets, baseline, opts.threshold);
    report.regression = {
      threshold: opts.threshold,
      failures,
      passed: failures.length === 0,
    };
    writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf-8');
    if (failures.length > 0) {
      for (const f of failures) {
        console.error(`  REGRESSION Tier ${f.tier}: ${(f.baselinePassRate * 100).toFixed(1)}% → ${(f.currentPassRate * 100).toFixed(1)}%`);
      }
      process.exit(1);
    }
  }
}

main();
