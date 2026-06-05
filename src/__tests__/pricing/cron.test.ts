/**
 * Unit tests for src/pricing/cron.ts — Monthly quota reset scheduler.
 *
 * Coverage:
 *   - startMonthlyResetCron / stopMonthlyResetCron
 *   - isCronRunning state tracking
 *   - triggerMonthlyReset manual trigger
 *   - Month change detection
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../pricing/quota.js', () => ({
  resetMonthlyQuotas: vi.fn(),
}));

vi.mock('../../pricing/audit.js', () => ({
  auditQuotaResetAll: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import {
  startMonthlyResetCron,
  stopMonthlyResetCron,
  triggerMonthlyReset,
  isCronRunning,
} from '../../pricing/cron.js';
import { resetMonthlyQuotas } from '../../pricing/quota.js';
import { auditQuotaResetAll } from '../../pricing/audit.js';

describe('Monthly reset cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stop any running cron from previous tests
    stopMonthlyResetCron();
  });

  afterEach(() => {
    stopMonthlyResetCron();
  });

  it('starts and stops the cron', () => {
    expect(isCronRunning()).toBe(false);

    startMonthlyResetCron();
    expect(isCronRunning()).toBe(true);

    stopMonthlyResetCron();
    expect(isCronRunning()).toBe(false);
  });

  it('start is idempotent (does not double-start)', () => {
    startMonthlyResetCron();
    startMonthlyResetCron(); // Should log a warning but not crash
    expect(isCronRunning()).toBe(true);
  });

  it('stop is idempotent (does not crash when already stopped)', () => {
    stopMonthlyResetCron(); // Nothing running
    stopMonthlyResetCron(); // Still nothing
    expect(isCronRunning()).toBe(false);
  });

  it('starts in non-running state', () => {
    expect(isCronRunning()).toBe(false);
  });
});

describe('triggerMonthlyReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets quotas and records audit entry', async () => {
    vi.mocked(resetMonthlyQuotas).mockResolvedValue(undefined);
    vi.mocked(auditQuotaResetAll).mockResolvedValue(undefined);

    const result = await triggerMonthlyReset();
    expect(result).toEqual({ resetCount: 0 });
    expect(resetMonthlyQuotas).toHaveBeenCalled();
    expect(auditQuotaResetAll).toHaveBeenCalledWith('system:manual');
  });

  it('throws when reset fails', async () => {
    vi.mocked(resetMonthlyQuotas).mockRejectedValue(new Error('Reset failed'));

    await expect(triggerMonthlyReset()).rejects.toThrow('Reset failed');
  });
});
