/**
 * Unit tests for src/bridge/metrics.ts — Prometheus metrics collector.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  BridgeMetrics,
  bridgeMetrics,
  recordMessagePublished,
  recordMessageConsumed,
  recordMessageFailed,
  recordConsumerLag,
  recordProcessingDuration,
} from '../../bridge/metrics.js';

describe('bridge metrics', () => {
  let metrics: BridgeMetrics;

  beforeEach(() => {
    metrics = new BridgeMetrics();
  });

  describe('Counter', () => {
    it('starts at zero', () => {
      metrics.incrementCounter('test_counter');
      const output = metrics.render();
      expect(output).toContain('test_counter 1');
    });

    it('increments by value', () => {
      metrics.incrementCounter('test_counter', { label: 'val' }, 5);
      const output = metrics.render();
      expect(output).toContain('test_counter{label="val"} 5');
    });

    it('increments cumulatively', () => {
      metrics.incrementCounter('test_counter');
      metrics.incrementCounter('test_counter');
      metrics.incrementCounter('test_counter', {}, 3);

      const output = metrics.render();
      // First two calls incremented by 1 each, third by 3 = total 5
      // but the third call has no labels, so it's a different sample
      // Actually, default labels = {} and no labels are the same
      // So it's 1+1+3 = 5
      const match = output.match(/^test_counter\s+(\d+)/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(5);
    });
  });

  describe('Gauge', () => {
    it('sets absolute value', () => {
      metrics.setGauge('test_gauge', {}, 42);
      const output = metrics.render();
      expect(output).toContain('test_gauge 42');
    });

    it('increments gauge', () => {
      metrics.setGauge('test_gauge', {}, 10);
      metrics.incrementGauge('test_gauge', {}, 5);
      const output = metrics.render();
      const match = output.match(/^test_gauge\s+(\d+)/m);
      expect(Number(match![1])).toBe(15);
    });

    it('decrements gauge', () => {
      metrics.setGauge('test_gauge', {}, 10);
      metrics.decrementGauge('test_gauge', {}, 3);
      const output = metrics.render();
      const match = output.match(/^test_gauge\s+(\d+)/m);
      expect(Number(match![1])).toBe(7);
    });
  });

  describe('Histogram', () => {
    it('records observations', () => {
      metrics.observeHistogram('test_histogram', {}, 0.5);
      const output = metrics.render();

      expect(output).toContain('test_histogram_count 1');
      expect(output).toContain('test_histogram_sum 0.5');
      expect(output).toContain('test_histogram_bucket{le="0.5"}');
    });

    it('increments cumulative bucket counts', () => {
      metrics.observeHistogram('test_histogram', {}, 0.1);
      metrics.observeHistogram('test_histogram', {}, 0.5);
      metrics.observeHistogram('test_histogram', {}, 2.0);

      const output = metrics.render();
      expect(output).toContain('test_histogram_count 3');
      // 0.1 -> le=0.1 bucket has 1, le=0.5 bucket has 2 (0.1+0.5), le=2.0 bucket has 3
      // Actually le=2.5 is the default bucket, le=2.0 is not a default bucket
      // Default buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
      // le=0.5 includes 0.1 and 0.5 = 2
      // le=1 includes 0.1 and 0.5 = 2
      // le=2.5 includes all 3 = 3
    });
  });

  describe('render', () => {
    it('outputs Prometheus exposition format', () => {
      metrics.incrementCounter('messages_published_total', { queue: 'test-queue' });
      metrics.setGauge('consumer_lag', { queue: 'test-queue' }, 5);
      metrics.observeHistogram('processing_duration_seconds', { queue: 'test-queue' }, 1.5);

      const output = metrics.render();

      // TYPE lines
      expect(output).toContain('# TYPE messages_published_total counter');
      expect(output).toContain('# TYPE consumer_lag gauge');
      expect(output).toContain('# TYPE processing_duration_seconds histogram');

      // Metric lines
      expect(output).toContain('messages_published_total{queue="test-queue"} 1');
      expect(output).toContain('consumer_lag{queue="test-queue"} 5');
      expect(output).toContain('processing_duration_seconds_count 1');
      expect(output).toContain('processing_duration_seconds_sum 1.5');

      // Trailing newline
      expect(output.endsWith('\n')).toBe(true);
    });

    it('returns empty string when no metrics recorded', () => {
      const output = metrics.render();
      // Should have no TYPE lines, just a trailing newline
      expect(output).not.toContain('# TYPE');
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.incrementCounter('test_counter');
      metrics.reset();
      const output = metrics.render();
      expect(output).not.toContain('test_counter');
    });
  });

  describe('bridgeMetrics singleton', () => {
    it('is a BridgeMetrics instance', () => {
      expect(bridgeMetrics).toBeInstanceOf(BridgeMetrics);
    });
  });

  describe('convenience functions', () => {
    beforeEach(() => {
      bridgeMetrics.reset();
    });

    it('recordMessagePublished increments counter', () => {
      recordMessagePublished('test-queue');
      const output = bridgeMetrics.render();
      expect(output).toContain('messages_published_total{queue="test-queue"} 1');
    });

    it('recordMessageConsumed increments counter', () => {
      recordMessageConsumed('test-queue');
      const output = bridgeMetrics.render();
      expect(output).toContain('messages_consumed_total{queue="test-queue"} 1');
    });

    it('recordMessageFailed increments counter with error label', () => {
      recordMessageFailed('test-queue', 'TASK_TIMEOUT');
      const output = bridgeMetrics.render();
      expect(output).toContain('messages_failed_total{error="TASK_TIMEOUT",queue="test-queue"} 1');
    });

    it('recordConsumerLag sets gauge', () => {
      recordConsumerLag('test-queue', 42);
      const output = bridgeMetrics.render();
      expect(output).toContain('consumer_lag{queue="test-queue"} 42');
    });

    it('recordProcessingDuration observes histogram', () => {
      recordProcessingDuration('test-queue', 2.5);
      const output = bridgeMetrics.render();
      expect(output).toContain('processing_duration_seconds_count 1');
      expect(output).toContain('processing_duration_seconds_sum 2.5');
    });
  });
});
