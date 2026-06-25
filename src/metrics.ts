import { bridgeMetrics } from './bridge/metrics.js';

export function trackRun(status: 'completed' | 'failed', repo: string, durationMs: number): void {
  bridgeMetrics.incrementCounter('stas_runs_total', { status, repo });
  bridgeMetrics.observeHistogram('stas_run_duration_seconds', { repo }, durationMs / 1000);
}

export function trackSandboxError(repo: string, errorType: string): void {
  bridgeMetrics.incrementCounter('stas_sandbox_errors_total', { repo, error: errorType });
}
