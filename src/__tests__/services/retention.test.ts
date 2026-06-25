/**
 * Unit tests for src/services/retention.ts — Data retention cleanup service.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db/connection.js', () => ({ queryWithRetry: mockQuery }));
vi.mock('../../config.js', () => ({ config: { queue: { redisUrl: 'redis://localhost:6379' } } }));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('services/retention', () => {
  let retention: typeof import('../../services/retention.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    retention = await import('../../services/retention.js');
  });

  describe('DEFAULT_RETENTION_POLICIES', () => {
    it('defines policies for all tracked tables', () => {
      expect(retention.DEFAULT_RETENTION_POLICIES).toHaveProperty('audit_logs');
      expect(retention.DEFAULT_RETENTION_POLICIES).toHaveProperty('webhook_events');
      expect(retention.DEFAULT_RETENTION_POLICIES).toHaveProperty('usage_records');
      expect(retention.DEFAULT_RETENTION_POLICIES).toHaveProperty('run_history');
      expect(retention.DEFAULT_RETENTION_POLICIES).toHaveProperty('credit_transactions');
    });

    it('audit_logs has 90-day soft-delete with archive', () => {
      const policy = retention.DEFAULT_RETENTION_POLICIES.audit_logs;
      expect(policy.retentionDays).toBe(90);
      expect(policy.deletionMode).toBe('soft');
      expect(policy.archiveBeforeDelete).toBe(true);
    });

    it('run_history has indefinite retention (-1)', () => {
      expect(retention.DEFAULT_RETENTION_POLICIES.run_history.retentionDays).toBe(-1);
    });
  });

  describe('runRetentionCleanup', () => {
    it('returns a report with results', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const report = await retention.runRetentionCleanup(true, ['webhook_events']);
      expect(report.dryRun).toBe(true);
      expect(report.results).toBeInstanceOf(Array);
    });

    it('returns a report for all tables when none specified', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const report = await retention.runRetentionCleanup(true);
      expect(report.results.length).toBeGreaterThan(0);
    });
  });

  describe('cleanRawWebhookPayloads', () => {
    it('returns result with dryRun flag', async () => {
      mockQuery.mockResolvedValue({ rows: [{ cnt: 0 }] });
      const result = await retention.cleanRawWebhookPayloads(true, 7);
      expect(result.dryRun).toBe(true);
      expect(result.table).toBe('webhook_events.payload');
    });

    it('returns 0 when no eligible payloads', async () => {
      mockQuery.mockResolvedValue({ rows: [{ cnt: 0 }] });
      const result = await retention.cleanRawWebhookPayloads(false);
      expect(result.rowsAffected).toBe(0);
    });
  });
});
