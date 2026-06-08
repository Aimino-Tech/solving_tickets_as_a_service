/**
 * Unit tests for src/monitoring/alerting.ts — Alerting rules and dispatch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockAddBreadcrumb = vi.fn();
const mockCaptureError = vi.fn();

vi.mock('../../monitoring/sentry.js', () => ({ addBreadcrumb: mockAddBreadcrumb, captureError: mockCaptureError }));

vi.mock('../../config.js', () => ({
  config: {
    alerting: { critQueueDepth: 200, warnQueueDepth: 50 },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('monitoring/alerting', () => {
  let alerting: typeof import('../../monitoring/alerting.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    alerting = await import('../../monitoring/alerting.js');
  });

  describe('dispatchAlert', () => {
    it('dispatches a critical alert', () => {
      alerting.dispatchAlert({
        severity: 'critical', rule: 'test_rule', message: 'Test critical',
        context: { foo: 'bar' }, timestamp: new Date().toISOString(),
      });
      expect(mockAddBreadcrumb).toHaveBeenCalled();
      expect(mockCaptureError).toHaveBeenCalled();
    });

    it('dispatches a warning alert (no Sentry error capture)', () => {
      alerting.dispatchAlert({
        severity: 'warning', rule: 'test_warn', message: 'Test warning',
        timestamp: new Date().toISOString(),
      });
      expect(mockAddBreadcrumb).toHaveBeenCalled();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });
  });

  describe('checkQueueDepth', () => {
    it('alerts critical when depth exceeds crit threshold for 5+ minutes', () => {
      alerting.checkQueueDepth(250, 5);
      expect(mockCaptureError).toHaveBeenCalled();
    });

    it('alerts warning when depth exceeds warn threshold', () => {
      alerting.checkQueueDepth(80, 1);
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });

    it('does not alert when depth is below warn threshold', () => {
      alerting.checkQueueDepth(10, 1);
      expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe('checkWorkerCrashLoop', () => {
    it('alerts critical when 3+ crashes in 5 minutes', () => {
      alerting.checkWorkerCrashLoop(3);
      expect(mockCaptureError).toHaveBeenCalled();
    });

    it('does not alert with fewer crashes', () => {
      alerting.checkWorkerCrashLoop(1);
      expect(mockCaptureError).not.toHaveBeenCalled();
    });
  });

  describe('reportDbConnectionFailure', () => {
    it('dispatches critical alert', () => {
      alerting.reportDbConnectionFailure('Connection timeout');
      expect(mockCaptureError).toHaveBeenCalled();
    });
  });

  describe('reportWebhookVerificationFailure', () => {
    it('dispatches warning alert', () => {
      alerting.reportWebhookVerificationFailure('github', 'Invalid signature');
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });
  });

  describe('reportRetryAttempt', () => {
    it('dispatches warning alert', () => {
      alerting.reportRetryAttempt('job-1', 'owner/repo', 42, 2, 'Timeout');
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });
  });

  describe('reportRateLimitHit', () => {
    it('dispatches warning alert', () => {
      alerting.reportRateLimitHit('github', 10, 100);
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });
  });

  describe('reportFixRunSuccess', () => {
    it('dispatches info alert', () => {
      alerting.reportFixRunSuccess('owner/repo', 42, 'https://github.com/pr/1');
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });
  });

  describe('reportNewAccountSignup', () => {
    it('dispatches info alert', () => {
      alerting.reportNewAccountSignup(123, 'testuser');
      expect(mockAddBreadcrumb).toHaveBeenCalled();
    });
  });
});
