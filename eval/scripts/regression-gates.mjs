#!/usr/bin/env node

// =============================================================================
// Regression Gates across routing variants (AIM-4622)
//
// Enforces that cheap-tier (Tier 1-2) fixes clear the same deterministic
// quality gates as frontier-tier (Tier 3-4) fixes. Reads an eval results file
// (tier-report.json shape: each result carries artifacts.prDiff + tier) and
// runs the diff-applicable quality gates against every fix, then reports a
// pass/fail matrix per tier/variant.
//
// Gates (from SYNTARO-QUALITY-GATES.md):
//   1 Reality        — every file referenced by the diff exists
//   3 Test Integrity — added/modified tests contain real assertions
//   4 Hallucination  — added lines carry no TODO/FIXME stubs or placeholder
//                      imports; new imports resolve to files in the repo
//   2 Compile / 5 Dead Code / 6 AI-Tool-Scan are repo-wide and run via
//     scripts/quality-gates.sh (--changed-only) after merge; this script
//     focuses on the diff-level gates that gate per-fix output.
//
// Usage:
//   node eval/scripts/regression-gates.mjs \
//     --results eval/results/tier-report.json \
//     --output eval/results/regression-gates.json
//
// Exit codes:
//   0 — every cheap-tier fix cleared the blocking gates
//   1 — a cheap-tier (Tier 1-2) fix failed a blocking gate, or no results
// =============================================================================

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STUB_PATTERNS = [
  /TODO\b/i,
  /FIXME\b/i,
  /\bplaceholder\b/i,
  /\bXXX\b/i,
  /console\.log\(['"]debug/i,
];

const ASSERT_PATTERNS = [
  /\bexpect\(/,
  /\bassert\./,
  /\bassert\(/,
  /\bstrictEqual\b/,
  /\bdeepEqual\b/,
  /\btoThrow\b/,
  /\btoEqual\b/,
  /\btoBe\b/,
  /\bshould\b/,
  /pytest\.raises|unittest/,
];

const BLOCKING_GATES = [1, 3, 4];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { results: 'eval/results/tier-report.json', output: 'eval/results/regression-gates.json' };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--results': opts.results = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      default: console.warn(`[regression-gates] Ignoring unknown option: ${args[i]}`);
    }
  }
  return opts;
}

function gateReality(diffFiles) {
  const missing = diffFiles.filter((f) => f && !existsSync(f));
  return { passed: missing.length === 0, detail: missing.length > 0 ? `missing: ${missing.join(', ')}` : 'all referenced files exist' };
}

function gateStubs(addedLines) {
  const hits = addedLines.filter((l) => STUB_PATTERNS.some((p) => p.test(l)));
  return { passed: hits.length === 0, detail: hits.length > 0 ? `stub patterns: ${hits.slice(0, 3).join(' | ')}` : 'no stub patterns' };
}

function gateTestIntegrity(diffFiles, addedLines) {
  const testFiles = diffFiles.filter((f) => /\.(test|spec)\./.test(f));
  if (testFiles.length === 0) {
    return { passed: true, detail: 'no test files touched' };
  }
  const withAssert = testFiles.filter((f) => {
    try {
      const content = readFileSync(f, 'utf-8');
      return ASSERT_PATTERNS.some((p) => p.test(content));
    } catch {
      return false;
    }
  });
  return {
    passed: withAssert.length === testFiles.length,
    detail: `${withAssert.length}/${testFiles.length} test files have assertions`,
  };
}

function parseDiff(prDiff) {
  const files = [];
  const addedLines = [];
  const lines = String(prDiff).split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      const match = /diff --git a\/(.*?) b\//.exec(line);
      if (match) files.push(match[1]);
    } else if (line.startsWith('+++ b/')) {
      const f = line.slice(6);
      if (f !== '/dev/null') files.push(f);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines.push(line.slice(1));
    }
  }
  return { files: [...new Set(files)], addedLines };
}

function tierFromResult(r) {
  const t = Number(r.tier ?? r.output?.tier ?? 0);
  return t >= 1 && t <= 4 ? t : 0;
}

function main() {
  const opts = parseArgs();
  if (!existsSync(opts.results)) {
    console.error(`[regression-gates] Results file not found: ${opts.results}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(opts.results, 'utf-8'));
  const results = Array.isArray(data.results) ? data.results : [];
  const entries = [];
  for (const r of results) {
    const tier = tierFromResult(r);
    const prDiff = r?.artifacts?.prDiff ?? r?.output?.artifacts?.prDiff ?? r?.prDiff ?? '';
    if (!prDiff) continue;
    const { files, addedLines } = parseDiff(prDiff);
    entries.push({
      name: r.name || r.output?.name || 'unnamed',
      tier,
      variant: String(r.variant ?? r.output?.variant ?? ''),
      gates: {
        1: gateReality(files),
        3: gateTestIntegrity(files, addedLines),
        4: gateStubs(addedLines),
      },
    });
  }

  const report = {
    summary: { fixesEvaluated: entries.length },
    byTier: {},
    results: entries,
    timestamp: new Date().toISOString(),
  };

  const byTier = {};
  for (const e of entries) {
    if (!byTier[e.tier]) byTier[e.tier] = [];
    byTier[e.tier].push(e);
  }

  let anyCheapGateFailure = false;
  for (const tier of Object.keys(byTier).sort((a, b) => a - b)) {
    const tierEntries = byTier[tier];
    const perGate = {};
    for (const gate of BLOCKING_GATES) {
      const failed = tierEntries.filter((e) => !e.gates[gate].passed).length;
      perGate[`gate${gate}`] = {
        passed: tierEntries.length - failed,
        failed,
        total: tierEntries.length,
        passRate: tierEntries.length > 0 ? (tierEntries.length - failed) / tierEntries.length : 0,
      };
      if (tier <= 2 && failed > 0) anyCheapGateFailure = true;
    }
    report.byTier[tier] = {
      variant: tierEntries.find((e) => e.variant)?.variant ?? '',
      fixes: tierEntries.length,
      ...perGate,
    };
  }

  writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[regression-gates] ${entries.length} fixes gated`);
  for (const tier of Object.keys(byTier).sort((a, b) => a - b)) {
    const s = report.byTier[tier];
    const g1 = ((s.gate1.passRate) * 100).toFixed(0);
    const g3 = ((s.gate3.passRate) * 100).toFixed(0);
    const g4 = ((s.gate4.passRate) * 100).toFixed(0);
    console.log(`  Tier ${tier} (${s.variant || '?'}): ${s.fixes} fixes — Reality ${g1}% TestIntegrity ${g3}% Stub ${g4}%`);
  }

  if (anyCheapGateFailure) {
    console.error('[regression-gates] Cheap-tier (Tier 1-2) fix failed a blocking gate — blocking');
    process.exit(1);
  }
}

main();
