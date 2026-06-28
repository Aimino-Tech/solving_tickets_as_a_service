import { bridgeMetrics } from './bridge/metrics.js';

export function trackRun(status: 'completed' | 'failed', repo: string, durationMs: number): void {
  bridgeMetrics.incrementCounter('stas_runs_total', { status, repo });
  bridgeMetrics.observeHistogram('stas_run_duration_seconds', { repo }, durationMs / 1000);
}

export function trackSandboxError(repo: string, errorType: string): void {
  bridgeMetrics.incrementCounter('stas_sandbox_errors_total', { repo, error: errorType });
}

export function trackSlaBreach(tenantId: string, tier: string, breachType: 'response' | 'resolution'): void {
  bridgeMetrics.incrementCounter('stas_sla_breaches_total', { tenant_id: tenantId, tier, breach_type: breachType });
}

export function trackSlaEscalation(tenantId: string, tier: string, level: string): void {
  bridgeMetrics.incrementCounter('stas_sla_escalations_total', { tenant_id: tenantId, tier, level });
}
