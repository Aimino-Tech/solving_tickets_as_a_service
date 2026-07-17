import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQueryWithRetry = vi.fn();

vi.mock('../../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

vi.mock('../../config.js', () => ({
  config: {},
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

// bridgeMetrics is needed for recordSLIMetrics but not tested here
vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: { setGauge: vi.fn() },
}));

describe('monitoring/slos', () => {
  let slos: typeof import('../../monitoring/slos.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    slos = await import('../../monitoring/slos.js');
  });

  describe('getWebhookLatencyP99', () => {
    it('returns p99 latency from webhook_events', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ percentile: 2.5 }] });
      const result = await slos.getWebhookLatencyP99();
      expect(result).toBeCloseTo(2.5);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
      const query = mockQueryWithRetry.mock.calls[0][0] as string;
      expect(query).toContain('webhook_events');
      expect(query).toContain('percentile_cont(0.99)');
    });

    it('returns 0 when no data exists', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ percentile: null }] });
      const result = await slos.getWebhookLatencyP99();
      expect(result).toBe(0);
    });

    it('returns 0 on query error', async () => {
      mockQueryWithRetry.mockRejectedValueOnce(new Error('DB down'));
      const result = await slos.getWebhookLatencyP99();
      expect(result).toBe(0);
    });

    it('accepts custom windowMinutes', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ percentile: 1.0 }] });
      await slos.getWebhookLatencyP99(120);
      expect(mockQueryWithRetry.mock.calls[0][1][0]).toContain('120');
    });
  });

  describe('getQueueProcessingTimeP95', () => {
    it('returns p95 in minutes from run_history', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ percentile: 300000 }] });
      const result = await slos.getQueueProcessingTimeP95();
      expect(result).toBeCloseTo(5);
    });

    it('returns 0 when no data', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ percentile: null }] });
      const result = await slos.getQueueProcessingTimeP95();
      expect(result).toBe(0);
    });

    it('returns 0 on query error', async () => {
      mockQueryWithRetry.mockRejectedValueOnce(new Error('DB down'));
      const result = await slos.getQueueProcessingTimeP95();
      expect(result).toBe(0);
    });
  });

  describe('getAgentSuccessRate', () => {
    it('returns success percentage from run_history', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ total: 10, succeeded: 7 }] });
      const result = await slos.getAgentSuccessRate();
      expect(result).toBe(70);
    });

    it('returns 0 when no runs exist', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ total: 0, succeeded: 0 }] });
      const result = await slos.getAgentSuccessRate();
      expect(result).toBe(0);
    });

    it('returns 0 on query error', async () => {
      mockQueryWithRetry.mockRejectedValueOnce(new Error('DB down'));
      const result = await slos.getAgentSuccessRate();
      expect(result).toBe(0);
    });

    it('returns 100 when all succeeded', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ total: 5, succeeded: 5 }] });
      const result = await slos.getAgentSuccessRate();
      expect(result).toBe(100);
    });
  });

  describe('getUptime', () => {
    it('returns availability percentage from health_checks', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ total: 100, healthy: 99 }] });
      const result = await slos.getUptime();
      expect(result).toBeCloseTo(99);
    });

    it('returns 0 when no health checks exist', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ total: 0, healthy: 0 }] });
      const result = await slos.getUptime();
      expect(result).toBe(0);
    });

    it('returns 0 on query error', async () => {
      mockQueryWithRetry.mockRejectedValueOnce(new Error('DB down'));
      const result = await slos.getUptime();
      expect(result).toBe(0);
    });
  });

  describe('generateSLOReport', () => {
    it('returns a complete SLO report from real metrics', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ percentile: 1.2 }] })
        .mockResolvedValueOnce({ rows: [{ percentile: 120000 }] })
        .mockResolvedValueOnce({ rows: [{ total: 20, succeeded: 18 }] })
        .mockResolvedValueOnce({ rows: [{ total: 50, healthy: 50 }] });

      const report = await slos.generateSLOReport();

      expect(report.timestamp).toBeDefined();
      expect(report.overallStatus).toBe('passing');
      expect(report.compliant).toBe(4);
      expect(report.warning).toBe(0);
      expect(report.breached).toBe(0);
      expect(report.slis).toHaveLength(4);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(4);
    });

    it('detects breaches from real metrics', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ percentile: 10 }] })
        .mockResolvedValueOnce({ rows: [{ percentile: 1200000 }] })
        .mockResolvedValueOnce({ rows: [{ total: 20, succeeded: 5 }] })
        .mockResolvedValueOnce({ rows: [{ total: 50, healthy: 30 }] });

      const report = await slos.generateSLOReport();

      expect(report.overallStatus).toBe('failing');
      expect(report.breached).toBeGreaterThanOrEqual(1);
    });

    it('uses overrides when provided', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ percentile: 60000 }] })
        .mockResolvedValueOnce({ rows: [{ total: 50, healthy: 50 }] });

      const report = await slos.generateSLOReport(60, {
        webhook_processing_latency_p99: 99,
        agent_success_rate: 100,
      });

      expect(report.slis[0].currentValue).toBe(99);
      expect(report.slis[2].currentValue).toBe(100);
      expect(report.slis[1].currentValue).toBeCloseTo(1);
      expect(report.slis[3].currentValue).toBe(100);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
    });
  });
});
