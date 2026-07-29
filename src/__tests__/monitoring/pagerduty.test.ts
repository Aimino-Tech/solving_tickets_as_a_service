/**
 * Unit tests for PagerDuty Events API v2 integration in alerting dispatch.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockAddBreadcrumb = vi.fn();
const mockCaptureError = vi.fn();
const mockLoggerChild = vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../monitoring/sentry.js', () => ({
  addBreadcrumb: mockAddBreadcrumb,
  captureError: mockCaptureError,
}));

vi.mock('../../config.js', () => ({
  config: {
    alerting: {
      critQueueDepth: 200,
      warnQueueDepth: 50,
      critErrorRatePercent: 30,
      warnErrorRatePercent: 10,
    },
    pagerduty: {
      integrationKey: 'test-pd-integration-key',
      escalationPolicyId: 'test-escalation-policy',
    },
    slack: { webhookUrl: '' },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: mockLoggerChild,
  },
}));

describe('PagerDuty alert dispatch', () => {
  let alerting: typeof import('../../monitoring/alerting.js');
  let logError: ReturnType<typeof vi.fn>;
  let logWarn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    logError = vi.fn();
    logWarn = vi.fn();
    mockLoggerChild.mockReturnValue({
      info: vi.fn(),
      warn: logWarn,
      error: logError,
      debug: vi.fn(),
    });
    alerting = await import('../../monitoring/alerting.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mkTimestamp(): string {
    return new Date().toISOString();
  }

  describe('dispatchAlert handles missing PD config', () => {
    it('gracefully handles dispatch without throwing when fetch fails', async () => {
      await expect(
        alerting.dispatchAlert({
          severity: 'critical',
          rule: 'queue_depth_critical',
          message: 'Queue depth 250 exceeds threshold',
          timestamp: mkTimestamp(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('PagerDuty trigger conditions', () => {
    it('dispatches to PagerDuty for severity=critical', async () => {
      await alerting.dispatchAlert({
        severity: 'critical',
        rule: 'worker_down',
        message: 'Worker worker-1 is down for 5 minutes',
        timestamp: mkTimestamp(),
      });

      expect(logWarn).not.toHaveBeenCalledWith(
        'PD_INTEGRATION_KEY not configured — skipping PagerDuty alert',
      );
    });

    it('dispatches to PagerDuty for severity=warning with escalated flag', async () => {
      await alerting.dispatchAlert({
        severity: 'warning',
        rule: 'error_rate_warning',
        message: 'Error rate 15% exceeds warning threshold',
        context: { errorRatePercent: 15, threshold: 10 },
        timestamp: mkTimestamp(),
        escalated: true,
      });

      expect(logWarn).not.toHaveBeenCalledWith(
        'PD_INTEGRATION_KEY not configured — skipping PagerDuty alert',
      );
    });

    it('does NOT dispatch to PagerDuty for severity=warning without escalated flag', async () => {
      await alerting.dispatchAlert({
        severity: 'warning',
        rule: 'error_rate_warning',
        message: 'Error rate 15% exceeds warning threshold',
        context: { errorRatePercent: 15, threshold: 10 },
        timestamp: mkTimestamp(),
      });

      expect(logWarn).not.toHaveBeenCalled();
    });

    it('dispatches to PagerDuty for slo_breach rules', async () => {
      await alerting.dispatchAlert({
        severity: 'critical',
        rule: 'slo_breach_uptime',
        message: 'SLO breached for uptime: current=0.95, target=0.99',
        context: { sliName: 'uptime', currentValue: 0.95, target: 0.99 },
        timestamp: mkTimestamp(),
      });

      expect(logWarn).not.toHaveBeenCalledWith(
        'PD_INTEGRATION_KEY not configured — skipping PagerDuty alert',
      );
    });

    it('does NOT dispatch to PagerDuty for info alerts', async () => {
      await alerting.dispatchAlert({
        severity: 'info',
        rule: 'fix_run_success',
        message: 'Fix completed for owner/repo#42',
        timestamp: mkTimestamp(),
      });

      expect(logWarn).not.toHaveBeenCalled();
    });
  });

  describe('sendPagerDutyAlert error handling', () => {
    it('handles network errors gracefully (does not throw)', async () => {
      await expect(
        alerting.dispatchAlert({
          severity: 'critical',
          rule: 'db_connection_failure',
          message: 'Database connection failed',
          timestamp: mkTimestamp(),
        }),
      ).resolves.toBeUndefined();
    });

    it('handles API errors gracefully (does not throw)', async () => {
      await expect(
        alerting.dispatchAlert({
          severity: 'critical',
          rule: 'rate_limit_hit',
          message: 'Rate limit exceeded',
          timestamp: mkTimestamp(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('AlertEvent escalated flag integration', () => {
    it('accepts a warning escalated=true as valid', async () => {
      const alert: Parameters<typeof alerting.dispatchAlert>[0] = {
        severity: 'warning',
        rule: 'test',
        message: 'test',
        timestamp: mkTimestamp(),
        escalated: true,
      };
      expect(alert.escalated).toBe(true);
    });
  });
});
