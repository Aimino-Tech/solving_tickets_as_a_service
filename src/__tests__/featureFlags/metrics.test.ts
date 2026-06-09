/**
 * Unit tests for src/featureFlags/metrics.ts — Feature flag Prometheus metrics.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('featureFlags/metrics', () => {
  let metrics: typeof import('../../featureFlags/metrics.js');

  beforeEach(async () => {
    metrics = await import('../../featureFlags/metrics.js');
  });

  afterEach(() => {
    metrics.resetFeatureFlagMetrics();
    vi.restoreAllMocks();
  });

  describe('recordFeatureFlagEvaluation', () => {
    it('increments counter for enabled result (S1)', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_a",result="enabled"} 1');
    });

    it('increments counter for disabled result (S3)', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'disabled');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_a",result="disabled"} 1');
    });

    it('accumulates multiple evaluations on same flag (S1)', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      metrics.recordFeatureFlagEvaluation('flag_a', 'disabled');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_a",result="enabled"} 2');
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_a",result="disabled"} 1');
    });

    it('handles multiple distinct flags independently', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      metrics.recordFeatureFlagEvaluation('flag_b', 'disabled');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_a",result="enabled"} 1');
      expect(output).toContain('feature_flag_evaluations_total{flag="flag_b",result="disabled"} 1');
    });
  });

  describe('recordFeatureFlagOverride', () => {
    it('increments override counter for an account (S2)', () => {
      metrics.recordFeatureFlagOverride('flag_a', '42');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_overrides_total{flag="flag_a",account="42"} 1');
    });

    it('increments override counter for global scope', () => {
      metrics.recordFeatureFlagOverride('flag_a', 'global');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_overrides_total{flag="flag_a",account="global"} 1');
    });

    it('accumulates multiple overrides', () => {
      metrics.recordFeatureFlagOverride('flag_a', '42');
      metrics.recordFeatureFlagOverride('flag_a', '42');
      metrics.recordFeatureFlagOverride('flag_a', '99');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('feature_flag_overrides_total{flag="flag_a",account="42"} 2');
      expect(output).toContain('feature_flag_overrides_total{flag="flag_a",account="99"} 1');
    });
  });

  describe('renderFeatureFlagMetrics', () => {
    it('returns empty when no metrics recorded (S1 start)', () => {
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toBe('');
    });

    it('includes HELP and TYPE lines', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      metrics.recordFeatureFlagOverride('flag_a', '42');
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toContain('# HELP feature_flag_evaluations_total');
      expect(output).toContain('# TYPE feature_flag_evaluations_total counter');
      expect(output).toContain('# HELP feature_flag_overrides_total');
      expect(output).toContain('# TYPE feature_flag_overrides_total counter');
    });
  });

  describe('resetFeatureFlagMetrics', () => {
    it('clears all counters', () => {
      metrics.recordFeatureFlagEvaluation('flag_a', 'enabled');
      metrics.recordFeatureFlagOverride('flag_a', '42');
      metrics.resetFeatureFlagMetrics();
      const output = metrics.renderFeatureFlagMetrics();
      expect(output).toBe('');
    });
  });
});
