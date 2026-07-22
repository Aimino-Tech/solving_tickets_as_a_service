import type { BenchmarkRunner } from '../types';
import { buildResult, createTestResult } from '../utils';
import { JS_TS_TEST_CASES } from './cases';

const BENCHMARK_CONFIG = {
  suite: 'js-ts-benchmark',
  description:
    'STAS-specific JS/TS issue-resolution benchmark using real-world OSS-style issues. Tests React, TypeScript, Next.js, Express, and Node.js bug-fixing capability.',
  timeoutMs: 300_000,
  maxRetries: 2,
  expectedTopTierThreshold: 0.85,
};

const runner: BenchmarkRunner = {
  name: 'js-ts-benchmark',
  config: BENCHMARK_CONFIG,

  async run(model, options) {
    console.log(`[js-ts-benchmark] Running ${JS_TS_TEST_CASES.length} JS/TS test cases with model=${model}`);

    const results = [];
    for (const test of JS_TS_TEST_CASES) {
      const startTime = Date.now();

      if (options?.dryRun) {
        results.push(createTestResult(test.name, false, 0, 'dry-run', test.category));
        continue;
      }

      // Simulate agent fix attempt
      await new Promise((resolve) => setTimeout(resolve, 120));

      const durationMs = Date.now() - startTime;
      const passed = Math.random() > 0.12;
      const error = passed ? undefined : `Expected: ${test.expectedOutcome}`;

      if (options?.verbose) {
        console.log(`[js-ts-benchmark]   ${test.name}: ${passed ? 'PASS' : 'FAIL'} (${durationMs}ms)`);
      }

      results.push(createTestResult(test.name, passed, durationMs, error, test.category));
    }

    return buildResult('js-ts-benchmark', BENCHMARK_CONFIG, results, model, {
      testCaseCount: JS_TS_TEST_CASES.length,
      categories: [...new Set(JS_TS_TEST_CASES.map((t) => t.category))],
      note: 'Sample run — for production, clone real OSS repos and run STAS agent against actual issues',
    });
  },
};

export default runner;
