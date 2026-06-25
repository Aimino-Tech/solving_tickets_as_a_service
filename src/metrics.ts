import { bridgeMetrics } from './bridge/metrics.js';

export function trackRun(status: 'completed' | 'failed', repo: string, durationMs: number): void {
  bridgeMetrics.incrementCounter('stas_runs_total', { status, repo });
  bridgeMetrics.observeHistogram('stas_run_duration_seconds', { repo }, durationMs / 1000);
}

export function trackSandboxError(repo: string, errorType: string): void {
  bridgeMetrics.incrementCounter('stas_sandbox_errors_total', { repo, error: errorType });
}

/**
 * Track an E2B sandbox failure with specific error classification.
 * Increments both the generic sandbox error counter and the E2B-specific counter.
 */
export function trackE2BError(repo: string, errorType: string): void {
  bridgeMetrics.incrementCounter('stas_e2b_failures_total', { repo, error: errorType });
  bridgeMetrics.incrementCounter('stas_sandbox_errors_total', { repo, error: `e2b_${errorType}` });
}

/**
 * Track an E2B → Docker fallback event.
 */
export function trackE2BFallback(repo: string, reason: string): void {
  bridgeMetrics.incrementCounter('stas_e2b_fallback_to_docker_total', { repo, reason });
  bridgeMetrics.incrementCounter('stas_sandbox_fallback_total', { repo, from: 'e2b', to: 'docker' });
}

/**
 * Track E2B template validation result.
 */
export function trackE2BTemplateValidation(ok: boolean, templateId: string, errorType?: string): void {
  bridgeMetrics.setGauge('e2b_template_valid', { template: templateId }, ok ? 1 : 0);
  if (!ok && errorType) {
    bridgeMetrics.incrementCounter('e2b_template_validation_failures_total', {
      template: templateId,
      error: errorType,
    });
  }
}

/**
 * Track E2B API health check result (for Celery beat periodic task).
 */
export function trackE2BHealthCheck(ok: boolean, errorType?: string): void {
  bridgeMetrics.setGauge('e2b_health_check', {}, ok ? 1 : 0);
  bridgeMetrics.incrementCounter('e2b_health_checks_total', { status: ok ? 'ok' : 'fail' });
  if (!ok && errorType) {
    bridgeMetrics.incrementCounter('e2b_health_check_failures_total', { error: errorType });
  }
}
