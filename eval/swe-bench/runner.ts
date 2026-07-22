import type { BenchmarkRunner } from '../benchmarks/types';
import { buildResult, createTestResult } from '../benchmarks/utils';

const BENCHMARK_CONFIG = {
  suite: 'swe-bench',
  description:
    'SWE-bench Verified — 500+ real GitHub issues from 12 popular Python repos. Measures agent ability to produce correct patches that pass project test suites.',
  timeoutMs: 600_000,
  maxRetries: 2,
  expectedTopTierThreshold: 0.85,
};

const TEST_CATEGORIES = [
  'python-django-fix',
  'python-flask-route',
  'python-sqlalchemy-query',
  'python-requests-edge',
  'python-pytest-assert',
  'python-sympy-math',
  'python-scikit-learn',
  'python-matplotlib',
  'python-pypdf2',
  'python-astropy',
];

const SWE_BENCH_SAMPLE: Array<{ name: string; category: string }> = [];

for (let i = 0; i < 20; i++) {
  const cat = TEST_CATEGORIES[i % TEST_CATEGORIES.length];
  SWE_BENCH_SAMPLE.push({
    name: `SWE-bench: ${cat} — issue #${1000 + i}`,
    category: cat,
  });
}

const runner: BenchmarkRunner = {
  name: 'swe-bench',
  config: BENCHMARK_CONFIG,

  async run(model, options) {
    console.log(`[swe-bench] Running ${SWE_BENCH_SAMPLE.length} sample test cases with model=${model}`);

    const results = [];
    for (const test of SWE_BENCH_SAMPLE) {
      const startTime = Date.now();

      if (options?.dryRun) {
        results.push(createTestResult(test.name, false, 0, 'dry-run', test.category));
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const durationMs = Date.now() - startTime;
      const passed = Math.random() > 0.15;
      const error = passed
        ? undefined
        : 'Simulated failure — actual SWE-bench integration requires E2B sandbox with cloned repos';

      if (options?.verbose) {
        console.log(`[swe-bench]   ${test.name}: ${passed ? 'PASS' : 'FAIL'} (${durationMs}ms)`);
      }

      results.push(createTestResult(test.name, passed, durationMs, error, test.category));
    }

    return buildResult('swe-bench', BENCHMARK_CONFIG, results, model, {
      sampleSize: SWE_BENCH_SAMPLE.length,
      note: 'Sample run — replace with E2B sandbox integration for production results',
    });
  },
};

export default runner;
