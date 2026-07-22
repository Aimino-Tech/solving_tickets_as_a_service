/** Benchmark result for a single test case */
export interface TestResult {
  name: string;
  passed: boolean;
  score: number;
  durationMs: number;
  error?: string;
  category?: string;
}

/** Benchmark run output */
export interface BenchmarkResult {
  name: string;
  version: string;
  timestamp: string;
  model: string;
  config: BenchmarkConfig;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    avgDurationMs: number;
  };
  results: TestResult[];
  metadata: Record<string, unknown>;
}

/** Configuration for a single benchmark */
export interface BenchmarkConfig {
  suite: string;
  description: string;
  timeoutMs: number;
  maxRetries: number;
  expectedTopTierThreshold: number;
}

/** Benchmark runner interface — each benchmark exports one */
export interface BenchmarkRunner {
  name: string;
  config: BenchmarkConfig;
  run: (model: string, options?: RunOptions) => Promise<BenchmarkResult>;
}

export interface RunOptions {
  outputDir?: string;
  verbose?: boolean;
  dryRun?: boolean;
}

/** Tracking entry for historical scores */
export interface TrackingEntry {
  runId: string;
  timestamp: string;
  model: string;
  commitSha: string;
  results: Record<
    string,
    {
      passRate: number;
      total: number;
      passed: number;
    }
  >;
  metadata: {
    agentVersion: string;
    promptVersion: string;
    notes?: string;
  };
}

/** Aggregated comparison across runs */
export interface ScoreTrend {
  benchmark: string;
  runs: Array<{
    date: string;
    passRate: number;
    runId: string;
  }>;
  trend: 'improving' | 'stable' | 'declining';
  currentPassRate: number;
  topTierThreshold: number;
  isTopTier: boolean;
}
