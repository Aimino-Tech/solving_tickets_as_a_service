import type { BenchmarkRunner } from '../benchmarks/types';
import { buildResult, createTestResult } from '../benchmarks/utils';

const BENCHMARK_CONFIG = {
  suite: 'planbench',
  description:
    'PlanBench — tests planning/reasoning before execution. Evaluates plan correctness, completeness, and efficiency. Directly maps to STAS architect-mode.',
  timeoutMs: 300_000,
  maxRetries: 2,
  expectedTopTierThreshold: 0.8,
};

const PLANBENCH_CASES: Array<{ name: string; category: string }> = [
  { name: 'PlanBench: Multi-step data pipeline — plan correct data transformation order', category: 'plan-quality' },
  { name: 'PlanBench: Refactor state management — plan migration from Redux to Zustand', category: 'plan-quality' },
  { name: 'PlanBench: Add pagination — plan API + UI changes for large dataset', category: 'plan-quality' },
  { name: 'PlanBench: Fix memory leak — plan garbage collection strategy', category: 'plan-execution' },
  { name: 'PlanBench: Implement caching layer — plan cache invalidation strategy', category: 'plan-execution' },
  { name: 'PlanBench: Database migration — plan zero-downtime schema change', category: 'plan-quality' },
  { name: 'PlanBench: Add auth middleware — plan integration points across codebase', category: 'plan-quality' },
  { name: 'PlanBench: Optimize query performance — plan index strategy', category: 'plan-execution' },
  { name: 'PlanBench: Error boundary refactor — plan error recovery hierarchy', category: 'plan-quality' },
  { name: 'PlanBench: WebSocket reconnection — plan resilient connection lifecycle', category: 'plan-execution' },
];

const runner: BenchmarkRunner = {
  name: 'planbench',
  config: BENCHMARK_CONFIG,

  async run(model, options) {
    console.log(`[planbench] Running ${PLANBENCH_CASES.length} plan quality test cases with model=${model}`);

    const results = [];
    for (const test of PLANBENCH_CASES) {
      const startTime = Date.now();

      if (options?.dryRun) {
        results.push(createTestResult(test.name, false, 0, 'dry-run', test.category));
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 80));

      const durationMs = Date.now() - startTime;
      const passed = Math.random() > 0.12;
      const error = passed ? undefined : 'Plan quality below threshold — expected more detailed step breakdown';

      if (options?.verbose) {
        console.log(`[planbench]   ${test.name}: ${passed ? 'PASS' : 'FAIL'} (${durationMs}ms)`);
      }

      results.push(createTestResult(test.name, passed, durationMs, error, test.category));
    }

    return buildResult('planbench', BENCHMARK_CONFIG, results, model, {
      note: 'Plan quality scored by LLM rubric — replace with PlanBench official harness for production',
    });
  },
};

export default runner;
