import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BenchmarkResult, ScoreTrend, TrackingEntry } from './types';

const TRACKING_FILE = resolve(import.meta.dirname, '../results/tracking.json');

function loadTracking(): TrackingEntry[] {
  if (!existsSync(TRACKING_FILE)) return [];
  try {
    const raw = readFileSync(TRACKING_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveTracking(entries: TrackingEntry[]): void {
  const dir = dirname(TRACKING_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TRACKING_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

export function recordRun(
  result: BenchmarkResult,
  commitSha: string,
  metadata: { agentVersion: string; promptVersion: string; notes?: string },
): void {
  const entries = loadTracking();
  const entry: TrackingEntry = {
    runId: result.name,
    timestamp: result.timestamp,
    model: result.model,
    commitSha,
    results: {
      [result.name]: {
        passRate: result.summary.passRate,
        total: result.summary.total,
        passed: result.summary.passed,
      },
    },
    metadata,
  };
  entries.push(entry);
  saveTracking(entries);
}

export function recordMultiRun(
  results: BenchmarkResult[],
  commitSha: string,
  metadata: { agentVersion: string; promptVersion: string; notes?: string },
): void {
  const entries = loadTracking();
  const combinedResults: TrackingEntry['results'] = {};
  for (const r of results) {
    combinedResults[r.name] = {
      passRate: r.summary.passRate,
      total: r.summary.total,
      passed: r.summary.passed,
    };
  }
  const entry: TrackingEntry = {
    runId: `bench-${results.map((r) => r.name).join('-')}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    model: results[0]?.model ?? 'unknown',
    commitSha,
    results: combinedResults,
    metadata,
  };
  entries.push(entry);
  saveTracking(entries);
}

export function getTrend(benchmarkName: string, topTierThreshold: number): ScoreTrend | null {
  const entries = loadTracking();
  const relevant = entries
    .filter((e) => e.results[benchmarkName])
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (relevant.length === 0) return null;

  const runs = relevant.map((e) => ({
    date: e.timestamp,
    passRate: e.results[benchmarkName].passRate,
    runId: e.runId,
  }));

  const rates = runs.map((r) => r.passRate);
  const trend: ScoreTrend['trend'] =
    rates.length < 2
      ? 'stable'
      : rates[rates.length - 1] > rates[0] + 0.02
        ? 'improving'
        : rates[rates.length - 1] < rates[0] - 0.02
          ? 'declining'
          : 'stable';

  return {
    benchmark: benchmarkName,
    runs,
    trend,
    currentPassRate: rates[rates.length - 1],
    topTierThreshold,
    isTopTier: rates[rates.length - 1] >= topTierThreshold,
  };
}

export function getAllTrends(benchmarkConfigs: Record<string, number>): ScoreTrend[] {
  return Object.entries(benchmarkConfigs)
    .map(([name, threshold]) => getTrend(name, threshold))
    .filter((t): t is ScoreTrend => t !== null);
}

export function getAllRuns(): TrackingEntry[] {
  return loadTracking();
}

export function getLatestRun(): TrackingEntry | null {
  const entries = loadTracking();
  if (entries.length === 0) return null;
  return entries.reduce((latest, e) =>
    new Date(e.timestamp).getTime() > new Date(latest.timestamp).getTime() ? e : latest,
  );
}

export function isReadyToPublish(configs: Record<string, number>): {
  ready: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const [benchmark, threshold] of Object.entries(configs)) {
    const trend = getTrend(benchmark, threshold);
    if (!trend) {
      failures.push(`${benchmark}: no benchmark runs recorded yet`);
      continue;
    }
    if (!trend.isTopTier) {
      failures.push(
        `${benchmark}: pass rate ${(trend.currentPassRate * 100).toFixed(1)}% is below top-tier threshold of ${(threshold * 100).toFixed(1)}%`,
      );
    }
  }
  return { ready: failures.length === 0, failures };
}
