/**
 * E2B Sandbox Template Validation Utility
 *
 * Verifies that the configured E2B template exists and is usable.
 * Called during startup and by the periodic Celery health check.
 *
 * Strategy:
 *   Attempt a lightweight Sandbox.create() with a very short timeout.
 *   If the template doesn't exist, E2B returns a "template not found" error.
 *   We destroy the sandbox immediately after creation to avoid resource leaks.
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { bridgeMetrics } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'e2b-validate' });

export interface E2bTemplateValidationResult {
  ok: boolean;
  templateId: string;
  sandboxId?: string;
  error?: string;
  durationMs: number;
}

/**
 * Verify that the configured E2B template exists by creating (and immediately
 * destroying) a sandbox instance.
 *
 * @returns A validation result with ok=true if the template is valid
 */
export async function validateE2bTemplate(): Promise<E2bTemplateValidationResult> {
  const start = Date.now();
  const templateId = config.e2b.templateId;
  const apiKey = config.e2b.apiKey;

  if (!apiKey) {
    log.warn('E2B_API_KEY not configured — skipping template validation');
    return {
      ok: false,
      templateId,
      error: 'E2B_API_KEY not configured',
      durationMs: Date.now() - start,
    };
  }

  log.info({ templateId }, 'Validating E2B template');

  try {
    const { Sandbox } = await import('e2b');
    const sandbox = await Sandbox.create({
      apiKey,
      template: templateId,
      timeoutMs: 10_000, // Short timeout — we just need to verify the template
    });

    const sandboxId = sandbox.sandboxId;

    // Immediately destroy to avoid resource leaks
    await sandbox.kill();

    const durationMs = Date.now() - start;
    log.info({ templateId, sandboxId, durationMs }, 'E2B template validation passed');

    bridgeMetrics.setGauge('e2b_template_valid', { template: templateId }, 1);

    return {
      ok: true,
      templateId,
      sandboxId,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = String(err);

    log.error({ templateId, error: errorMsg, durationMs }, 'E2B template validation FAILED');

    // Track failure in metrics
    bridgeMetrics.setGauge('e2b_template_valid', { template: templateId }, 0);
    bridgeMetrics.incrementCounter('e2b_template_validation_failures_total', {
      template: templateId,
      error: classifyE2bError(errorMsg),
    });

    return {
      ok: false,
      templateId,
      error: errorMsg,
      durationMs,
    };
  }
}

/**
 * Classify an E2B error into a broad category for metric labels.
 */
export function classifyE2bError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('template') && lower.includes('not found')) return 'template_not_found';
  if (lower.includes('api_key') || lower.includes('unauthorized') || lower.includes('forbidden')) return 'auth_error';
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many')) return 'rate_limited';
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset')) return 'network_error';
  return 'unknown';
}
