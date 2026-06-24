/**
 * Unit tests for src/billing/trial.ts — Free trial management.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRedisClient = {
  zcard: vi.fn(), zadd: vi.fn(), expire: vi.fn(),
  pipeline: vi.fn(() => ({ zadd: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) })),
  del: vi.fn(), on: vi.fn(), quit: vi.fn(),
};

vi.mock('ioredis', () => ({ default: function() { return mockRedisClient; }, Redis: function() { return mockRedisClient; } }));
vi.mock('../../config.js', () => ({ config: { queue: { redisUrl: 'redis://localhost:6379' }, stripe: { soloPriceId: 'price_solo_mock', teamPriceId: 'price_team_mock' } } }));
vi.mock('../../db/connection.js', () => ({ queryWithRetry: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('billing/trial', () => {
  let trial: typeof import('../../billing/trial.js');
  let mockQuery: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    trial = await import('../../billing/trial.js');
    mockQuery = (await import('../../db/connection.js')).queryWithRetry;
  });

  describe('getTrialUsage', () => {
    it('returns 0 when no usage exists', async () => {
      mockRedisClient.zcard.mockResolvedValue(0);
      expect(await trial.getTrialUsage(42)).toBe(0);
    });
    it('returns count from Redis', async () => {
      mockRedisClient.zcard.mockResolvedValue(3);
      expect(await trial.getTrialUsage(42)).toBe(3);
    });
    it('returns 0 on Redis error', async () => {
      mockRedisClient.zcard.mockRejectedValue(new Error('down'));
      expect(await trial.getTrialUsage(42)).toBe(0);
    });
  });

  describe('incrementTrialUsage', () => {
    it('uses Redis pipeline', async () => {
      await trial.incrementTrialUsage(42);
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
    });
  });

  describe('resetTrialUsage', () => {
    it('deletes the key', async () => {
      await trial.resetTrialUsage(42);
      expect(mockRedisClient.del).toHaveBeenCalled();
    });
  });

  describe('startTrial', () => {
    it('starts a new trial when none exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ trial_start: null, trial_end: null }] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const result = await trial.startTrial(42, 14);
      expect(result.trialStart).toBeInstanceOf(Date);
      expect(result.trialEnd).toBeInstanceOf(Date);
    });

    it('returns existing trial dates if already active', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 10);
      mockQuery.mockResolvedValueOnce({ rows: [{ trial_start: new Date(), trial_end: futureDate }] });
      const result = await trial.startTrial(42);
      expect(result.trialEnd).toEqual(futureDate);
    });
  });

  describe('getTrialStatus', () => {
    it('returns inactive when no trial exists', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const status = await trial.getTrialStatus(42);
      expect(status.isActive).toBe(false);
    });

    it('returns active when trial is in progress', async () => {
      mockQuery.mockResolvedValue({ rows: [{ trial_start: new Date(), trial_end: new Date(Date.now() + 86400000 * 5) }] });
      mockRedisClient.zcard.mockResolvedValue(2);
      const status = await trial.getTrialStatus(42);
      expect(status.isActive).toBe(true);
      expect(status.daysRemaining).toBeGreaterThan(0);
    });
  });

  describe('canUseTrial', () => {
    it('allows when active and under limit', async () => {
      mockQuery.mockResolvedValue({ rows: [{ trial_start: new Date(), trial_end: new Date(Date.now() + 86400000 * 5) }] });
      mockRedisClient.zcard.mockResolvedValue(1);
      expect((await trial.canUseTrial(42)).allowed).toBe(true);
    });
    it('blocks when trial ended', async () => {
      mockQuery.mockResolvedValue({ rows: [{ trial_start: new Date(Date.now() - 86400000 * 30), trial_end: new Date(Date.now() - 86400000) }] });
      mockRedisClient.zcard.mockResolvedValue(5);
      expect((await trial.canUseTrial(42)).allowed).toBe(false);
    });
  });

  describe('expireTrial', () => {
    it('updates trial_end to NOW()', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });
      await trial.expireTrial(42);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SET trial_end = NOW()'), [42]);
    });
  });
});
