import type { BenchmarkConfig, BenchmarkResult, TestResult } from './types';

export function createTestResult(
  name: string,
  passed: boolean,
  durationMs: number,
  error?: string,
  category?: string,
): TestResult {
  return { name, passed, score: passed ? 1 : 0, durationMs, error, category };
}

export function createSummary(results: TestResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? passed / total : 0;
  const durations = results.map((r) => r.durationMs).filter((d) => d > 0);
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  return { total, passed, failed, passRate, avgDurationMs };
}

export function buildResult(
  name: string,
  config: BenchmarkConfig,
  results: TestResult[],
  model: string,
  metadata: Record<string, unknown> = {},
): BenchmarkResult {
  return {
    name,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    model,
    config,
    summary: createSummary(results),
    results,
    metadata,
  };
}
