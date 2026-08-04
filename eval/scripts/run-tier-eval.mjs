#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

const TIER_MODELS = {
  1: process.env.ROUTING_TIER1_MODEL || 'openai:gpt-4o-mini',
  2: process.env.ROUTING_TIER2_MODEL || 'openai:gpt-4o-mini',
  3: process.env.ROUTING_TIER3_MODEL || 'anthropic:claude-sonnet-4',
  4: process.env.ROUTING_TIER4_MODEL || 'anthropic:claude-sonnet-4',
};

const TIER_TEST_CASES = {
  1: ['fix-python-syntax-error.yml', 'fix-python-import.yml', 'fix-python-type-error.yml'],
  2: ['fix-js-async-await.yml', 'fix-js-variable-scope.yml', 'fix-ts-type-annotation.yml'],
  3: ['fix-go-import.yml', 'fix-go-nil-check.yml'],
  4: ['edge-empty-repo.yml', 'edge-missing-dep.yml'],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tiers: [1, 2, 3, 4], sha: process.env.GITHUB_SHA || 'local' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier') {
      opts.tiers = args[++i].split(',').map(Number);
    } else if (args[i] === '--sha') {
      opts.sha = args[++i];
    }
  }
  return opts;
}

function runTier(tier, sha) {
  const model = TIER_MODELS[tier];
  const testFiles = TIER_TEST_CASES[tier];
  const config = join(ROOT, 'eval/promptfooconfig.yaml');
  const testArgs = [];
  for (const t of testFiles) {
    const file = join(ROOT, 'eval/test-cases', t);
    if (!existsSync(file)) {
      console.error(`[run-tier-eval] Missing test case: ${file}`);
      process.exitCode = 1;
      continue;
    }
    testArgs.push('--tests', file);
  }
  const output = join(ROOT, `eval/results/tier${tier}-${sha}.json`);
  console.log(`[run-tier-eval] Tier ${tier} → ${model} (${testFiles.length} tests)`);
  const res = spawnSync(
    'npx',
    ['promptfoo', 'eval', '--config', config, ...testArgs, '--output', output],
    { cwd: ROOT, stdio: 'inherit', shell: true }
  );
  if (res.status !== 0) {
    console.error(`[run-tier-eval] Tier ${tier} eval failed (exit ${res.status})`);
    process.exitCode = res.status ?? 1;
  } else {
    console.log(`[run-tier-eval] Tier ${tier} results → ${output}`);
  }
}

const opts = parseArgs();
for (const tier of opts.tiers) {
  runTier(tier, opts.sha);
}

console.log('[run-tier-eval] Done. Aggregate per-tier stats with:');
console.log('  node eval/scripts/full-report.mjs --input-dir eval/results --output eval/results/full-report.json --markdown eval/results/full-report.md');
