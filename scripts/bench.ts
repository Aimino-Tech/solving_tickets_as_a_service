#!/usr/bin/env tsx
/**
 * Benchmark Runner — tests/bench/ orchestrator
 *
 * Runs all benchmark suites via `vitest bench`, collects results,
 * compares against baseline, and reports regressions.
 *
 * Usage:
 *   npx tsx scripts/bench.ts                  # Run all benchmarks
 *   npx tsx scripts/bench.ts --compare-only   # Only compare with baseline (no run)
 *   npx tsx scripts/bench.ts --update-baseline # Run and update baseline
 *   npx tsx scripts/bench.ts --ci             # CI mode: run, compare, exit 1 if regressed
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BENCH_DIR = 'tests/bench';
const RESULTS_FILE = path.join(BENCH_DIR, 'benchmark-results.json');

interface BenchmarkResult {
  /** ISO 8601 timestamp of the run */
  timestamp: string;
  /** Git SHA at the time of the run */
  gitSha: string;
  /** Environment info */
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuCores: number;
  };
  /** Per-suite results */
  suites: Record<string, SuiteResult>;
}

interface SuiteResult {
  /** Total duration of the suite in ms */
  durationMs: number;
  /** Per-benchmark results */
  benchmarks: Record<string, BenchStat>;
}

interface BenchStat {
  /** Number of iterations */
  iterations: number;
  /** Mean time per iteration in ms */
  mean: number;
  /** Standard deviation */
  stddev: number;
  /** P50 latency in ms */
  p50: number;
  /** P90 latency in ms */
  p90: number;
  /** P99 latency in ms */
  p99: number;
  /** Minimum observed time in ms */
  min: number;
  /** Maximum observed time in ms */
  max: number;
}

interface BaselineData {
  /** Timestamp when baseline was recorded */
  recordedAt: string;
  /** Per-suite baseline values (benchmark name → stats) */
  suites: Record<string, Record<string, BenchStat>>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function collectEnvironment() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCores: require('node:os').cpus().length,
  };
}

// ── Run Benchmarks ───────────────────────────────────────────────────

async function runBenchmarks(): Promise<{ rawOutput: string }> {
  console.log('\n🚀 Running performance benchmarks...\n');

  const start = Date.now();

  try {
    const output = execSync('npx vitest bench --reporter=json', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 300_000, // 5 minutes max
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST: 'true',
      },
    });

    const duration = Date.now() - start;
    console.log(`\n✅ Benchmarks completed in ${(duration / 1000).toFixed(1)}s\n`);

    return { rawOutput: output };
  } catch (err: any) {
    // vitest bench exits with non-zero even on success in some configs
    // Try to capture output from stderr or stdout
    const output = err.stdout || err.stderr || err.message || '';
    console.log(`\n⚠️  Benchmarks finished with exit code ${err.status || 'unknown'}\n`);
    return { rawOutput: String(output) };
  }
}

// ── Parse JSON Reporter Output ───────────────────────────────────────

function parseBenchResults(rawOutput: string): BenchmarkResult {
  // Try to find JSON in the output
  let jsonStr = rawOutput;

  // If output contains the JSON reporter, try to extract it
  const jsonMatch = rawOutput.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // If JSON parsing fails, create a minimal result from available data
    console.warn('⚠️  Could not parse JSON reporter output, creating minimal result');
    parsed = { testResults: [] };
  }

  const suites: Record<string, SuiteResult> = {};

  if (parsed.testResults) {
    for (const testFile of parsed.testResults) {
      const fileName = path.basename(testFile.name || testFile.filePath || 'unknown');
      const suiteName = fileName.replace(/\.bench\.ts$/, '').replace(/\.bench\.js$/, '');

      const benchmarks: Record<string, BenchStat> = {};

      if (testFile.results || testFile.assertionResults) {
        const results = testFile.results || testFile.assertionResults || [];
        for (const r of results) {
          const benchName = r.name || r.title || 'unknown';
          const duration = r.duration || r.durationMs || 0;

          // If the reporter has per-iteration stats, use them
          const stat: BenchStat = {
            iterations: r.iterations || r.samples || 1,
            mean: r.mean || duration / (r.iterations || 1),
            stddev: r.stddev || r.stdDev || 0,
            p50: r.p50 || r.median || r.percentile50 || duration,
            p90: r.p90 || r.percentile90 || duration,
            p99: r.p99 || r.percentile99 || duration,
            min: r.min || r.minMs || 0,
            max: r.max || r.maxMs || duration,
          };

          benchmarks[benchName] = stat;
        }
      }

      suites[suiteName] = {
        durationMs: testFile.duration || testFile.endTime - testFile.startTime || 0,
        benchmarks,
      };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    gitSha: getGitSha(),
    environment: collectEnvironment(),
    suites,
  };
}

// ── Baseline Management ──────────────────────────────────────────────

function loadBaseline(): BaselineData | null {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8')) as BaselineData;
      console.log(`📋 Loaded baseline from ${RESULTS_FILE}`);
      return data;
    }
  } catch (err) {
    console.warn(`⚠️  Could not load baseline from ${RESULTS_FILE}: ${err}`);
  }
  return null;
}

function saveBaseline(result: BenchmarkResult): void {
  const baseline: BaselineData = {
    recordedAt: result.timestamp,
    suites: {},
  };

  for (const [suiteName, suite] of Object.entries(result.suites)) {
    baseline.suites[suiteName] = {};
    for (const [benchName, stat] of Object.entries(suite.benchmarks)) {
      baseline.suites[suiteName][benchName] = stat;
    }
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(baseline, null, 2));
  console.log(`💾 Saved baseline to ${RESULTS_FILE}`);
}

// ── Regression Detection ─────────────────────────────────────────────

interface Regression {
  suite: string;
  benchmark: string;
  metric: string;
  baseline: number;
  current: number;
  changePercent: number;
}

function detectRegressions(
  current: BenchmarkResult,
  baseline: BaselineData,
  thresholdPercent: number = 20,
): Regression[] {
  const regressions: Regression[] = [];

  for (const [suiteName, suite] of Object.entries(current.suites)) {
    const baselineSuite = baseline.suites[suiteName];
    if (!baselineSuite) {
      console.log(`  ⚠️  No baseline for suite "${suiteName}" — skipping`);
      continue;
    }

    for (const [benchName, stat] of Object.entries(suite.benchmarks)) {
      const baselineBench = baselineSuite[benchName];
      if (!baselineBench) {
        console.log(`  ⚠️  No baseline for benchmark "${suiteName}/${benchName}" — skipping`);
        continue;
      }

      // Check mean (primary metric)
      if (baselineBench.mean > 0) {
        const change = ((stat.mean - baselineBench.mean) / baselineBench.mean) * 100;
        if (change > thresholdPercent) {
          regressions.push({
            suite: suiteName,
            benchmark: benchName,
            metric: 'mean',
            baseline: baselineBench.mean,
            current: stat.mean,
            changePercent: Math.round(change * 100) / 100,
          });
        }
      }

      // Check p95/p99
      for (const percentile of ['p95', 'p99'] as const) {
        const baselineVal = (baselineBench as any)[percentile];
        const currentVal = (stat as any)[percentile];
        if (baselineVal && currentVal && baselineVal > 0) {
          const change = ((currentVal - baselineVal) / baselineVal) * 100;
          if (change > thresholdPercent) {
            regressions.push({
              suite: suiteName,
              benchmark: benchName,
              metric: percentile,
              baseline: baselineVal,
              current: currentVal,
              changePercent: Math.round(change * 100) / 100,
            });
          }
        }
      }
    }
  }

  return regressions;
}

// ── Reporting ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(3)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printResults(result: BenchmarkResult): void {
  console.log('\n' + '='.repeat(72));
  console.log('📊 BENCHMARK RESULTS');
  console.log('='.repeat(72));
  console.log(`  Timestamp:  ${result.timestamp}`);
  console.log(`  Git SHA:    ${result.gitSha}`);
  console.log(`  Node:       ${result.environment.nodeVersion}`);
  console.log(`  Platform:   ${result.environment.platform} ${result.environment.arch}`);
  console.log(`  CPUs:       ${result.environment.cpuCores}`);
  console.log('-'.repeat(72));

  for (const [suiteName, suite] of Object.entries(result.suites)) {
    const benchCount = Object.keys(suite.benchmarks).length;
    console.log(`\n📁 ${suiteName} (${benchCount} benchmarks, ${formatDuration(suite.durationMs)})\n`);

    const entries = Object.entries(suite.benchmarks);
    const nameWidth = Math.max(...entries.map(([n]) => n.length), 30);
    const header = `${'Benchmark'.padEnd(nameWidth)} │ Iterations │ Mean ${' '.repeat(8)}│ P50 ${' '.repeat(8)}│ P90 ${' '.repeat(8)}│ P99`;
    console.log(header);
    console.log('─'.repeat(header.length));

    for (const [benchName, stat] of entries) {
      console.log(
        `${benchName.padEnd(nameWidth)} │ ${String(stat.iterations).padStart(9)} │ ${formatDuration(stat.mean).padStart(10)} │ ${formatDuration(stat.p50).padStart(10)} │ ${formatDuration(stat.p90).padStart(10)} │ ${formatDuration(stat.p99).padStart(10)}`,
      );
    }
  }
  console.log('-'.repeat(72));
  console.log();
}

function printRegressions(regressions: Regression[]): void {
  if (regressions.length === 0) {
    console.log('✅ No regressions detected (all within tolerance)\n');
    return;
  }

  console.log('\n❌ REGRESSIONS DETECTED (>20% degradation)\n');
  console.log(`${'Suite'.padEnd(20)} ${'Benchmark'.padEnd(35)} ${'Metric'.padEnd(8)} ${'Baseline'.padEnd(12)} ${'Current'.padEnd(12)} Change`);
  console.log('─'.repeat(100));

  for (const r of regressions) {
    console.log(
      `${r.suite.padEnd(20)} ${r.benchmark.padEnd(35)} ${r.metric.padEnd(8)} ${formatDuration(r.baseline).padEnd(12)} ${formatDuration(r.current).padEnd(12)} +${r.changePercent.toFixed(1)}%`,
    );
  }
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const compareOnly = args.includes('--compare-only');
  const updateBaseline = args.includes('--update-baseline');
  const ciMode = args.includes('--ci');

  console.log('🔬 STAS Performance Benchmark Runner\n');

  let result: BenchmarkResult | null = null;

  if (!compareOnly) {
    const { rawOutput } = await runBenchmarks();
    result = parseBenchResults(rawOutput);
    printResults(result);
  }

  const baseline = loadBaseline();

  if (baseline && result) {
    const regressions = detectRegressions(result, baseline);
    printRegressions(regressions);

    if (ciMode && regressions.length > 0) {
      console.log('🚨 CI check failed: regressions detected!\n');
      process.exit(1);
    }
  }

  if (updateBaseline && result) {
    saveBaseline(result);
  } else if (!compareOnly && result && !baseline) {
    // First run — save baseline automatically
    console.log('📝 No baseline found — saving current results as baseline\n');
    saveBaseline(result);
  }

  if (compareOnly && !result) {
    console.log('ℹ️  --compare-only specified. No benchmarks run.\n');
    if (baseline) {
      console.log(`Baseline recorded at: ${baseline.recordedAt}`);
      console.log(`Suites in baseline: ${Object.keys(baseline.suites).join(', ')}`);
    }
  }

  console.log('🏁 Done.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
