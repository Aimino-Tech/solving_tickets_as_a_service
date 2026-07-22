#!/usr/bin/env npx tsx

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isReadyToPublish, recordMultiRun } from './tracker';
import type { BenchmarkConfig, BenchmarkResult, BenchmarkRunner } from './types';

const __dirname = import.meta.dirname;

const BENCHMARK_CONFIGS: Record<string, BenchmarkConfig> = {
  'swe-bench': {
    suite: 'swe-bench',
    description: 'SWE-bench Verified — industry standard issue-to-fix agent evaluation (500+ real GitHub issues)',
    timeoutMs: 600_000,
    maxRetries: 2,
    expectedTopTierThreshold: 0.85,
  },
  planbench: {
    suite: 'planbench',
    description: 'PlanBench — tests planning/reasoning before execution, maps to STAS plan-first architecture',
    timeoutMs: 300_000,
    maxRetries: 2,
    expectedTopTierThreshold: 0.8,
  },
  repobench: {
    suite: 'repobench',
    description: 'RepoBench — long-context repository understanding, matches "reads full repo" moat',
    timeoutMs: 300_000,
    maxRetries: 2,
    expectedTopTierThreshold: 0.8,
  },
  'js-ts-benchmark': {
    suite: 'js-ts-benchmark',
    description: 'STAS-specific JS/TS issue-resolution benchmark using real OSS issues',
    timeoutMs: 300_000,
    maxRetries: 2,
    expectedTopTierThreshold: 0.85,
  },
};

async function loadRunner(suite: string): Promise<BenchmarkRunner> {
  switch (suite) {
    case 'swe-bench':
      return (await import('../swe-bench/runner')).default;
    case 'planbench':
      return (await import('../planbench/runner')).default;
    case 'repobench':
      return (await import('../repobench/runner')).default;
    case 'js-ts-benchmark':
      return (await import('./js-ts-benchmark/runner')).default;
    default:
      throw new Error(`Unknown benchmark suite: ${suite}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {
    suite: string;
    model: string;
    output: string;
    verbose: boolean;
    dryRun: boolean;
    agentVersion: string;
    promptVersion: string;
    notes: string;
  } = {
    suite: 'full',
    model: process.env.STAS_MODEL || 'claude-sonnet-4',
    output: '',
    verbose: false,
    dryRun: false,
    agentVersion: process.env.STAS_AGENT_VERSION || 'dev',
    promptVersion: process.env.STAS_PROMPT_VERSION || 'dev',
    notes: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--suite':
        opts.suite = args[++i];
        break;
      case '--model':
        opts.model = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      case '--agent-version':
        opts.agentVersion = args[++i];
        break;
      case '--prompt-version':
        opts.promptVersion = args[++i];
        break;
      case '--notes':
        opts.notes = args[++i];
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        console.warn(`[core] Ignoring unknown option: ${args[i]}`);
    }
  }

  return opts;
}

async function runSuite(suite: string, model: string, dryRun: boolean, verbose: boolean): Promise<BenchmarkResult> {
  const runner = await loadRunner(suite);
  console.log(`[core] Running ${runner.name} (${runner.config.description})`);
  console.log(`[core]   Model: ${model}`);

  if (dryRun) {
    console.log(`[core]   DRY RUN — skipping execution`);
    return {
      name: runner.name,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      model,
      config: runner.config,
      summary: { total: 0, passed: 0, failed: 0, passRate: 0, avgDurationMs: 0 },
      results: [],
      metadata: { dryRun: true },
    };
  }

  const result = await runner.run(model, { verbose, dryRun });

  console.log(
    `[core]   Result: ${result.summary.passed}/${result.summary.total} passed (${(result.summary.passRate * 100).toFixed(1)}%)`,
  );
  if (result.summary.failed > 0 && verbose) {
    for (const r of result.results.filter((r) => !r.passed)) {
      console.log(`[core]     FAIL: ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    }
  }

  return result;
}

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(60));
  console.log('STAS BENCHMARK SUITE');
  console.log('='.repeat(60));
  console.log(`Suite: ${opts.suite}`);
  console.log(`Model: ${opts.model}`);
  console.log(`Agent: ${opts.agentVersion} / Prompt: ${opts.promptVersion}`);
  console.log(`Dry run: ${opts.dryRun}`);
  console.log('-'.repeat(60));

  const suites = opts.suite === 'full' ? Object.keys(BENCHMARK_CONFIGS) : [opts.suite];

  const results: BenchmarkResult[] = [];
  for (const suite of suites) {
    if (!BENCHMARK_CONFIGS[suite]) {
      console.error(`[core] Unknown suite: ${suite}. Available: ${Object.keys(BENCHMARK_CONFIGS).join(', ')}`);
      process.exit(1);
    }
    const result = await runSuite(suite, opts.model, opts.dryRun, opts.verbose);
    results.push(result);
  }

  const outputDir = opts.output || resolve(__dirname, '../results');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  for (const result of results) {
    const filePath = resolve(outputDir, `${result.name}-${result.timestamp.split('T')[0]}.json`);
    writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[core] Written: ${filePath}`);
  }

  try {
    const commitSha = process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    recordMultiRun(results, commitSha, {
      agentVersion: opts.agentVersion,
      promptVersion: opts.promptVersion,
      notes: opts.notes || undefined,
    });
  } catch {
    console.warn('[core] Could not record to tracking (no git context)');
  }

  console.log('-'.repeat(60));
  console.log('BENCHMARK SUMMARY');
  console.log('-'.repeat(60));
  for (const r of results) {
    const pct = (r.summary.passRate * 100).toFixed(1);
    const threshold = (r.config.expectedTopTierThreshold * 100).toFixed(1);
    const topTier = r.summary.passRate >= r.config.expectedTopTierThreshold ? '✅ TOP TIER' : '⬆️ NEEDS IMPROVEMENT';
    console.log(`  ${r.name}: ${r.summary.passed}/${r.summary.total} (${pct}%) — threshold ${threshold}% — ${topTier}`);
  }

  const topTierThresholds: Record<string, number> = {};
  for (const r of results) {
    topTierThresholds[r.name] = r.config.expectedTopTierThreshold;
  }
  const publishCheck = isReadyToPublish(topTierThresholds);
  console.log('-'.repeat(60));
  if (publishCheck.ready) {
    console.log('✅ ALL BENCHMARKS MEET TOP-TIER THRESHOLD — Ready to publish!');
  } else {
    console.log('⛔ NOT READY TO PUBLISH:');
    for (const f of publishCheck.failures) {
      console.log(`  • ${f}`);
    }
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[core] Fatal error:', err);
  process.exit(1);
});
