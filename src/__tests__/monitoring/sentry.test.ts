/**
 * Unit tests for src/monitoring/sentry.ts — Sentry initialization.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSentryInit = vi.fn();
const mockSentryAddBreadcrumb = vi.fn();
const mockSentryCaptureException = vi.fn();
const mockSentrySetUser = vi.fn();
const mockSentrySetTag = vi.fn();
const mockSentryWithScope = vi.fn((cb: any) => cb({ setContext: vi.fn() }));
const mockSentryIsInitialized = vi.fn(() => false);
const mockSetupExpressErrorHandler = vi.fn();

vi.mock('@sentry/node', () => ({
  init: mockSentryInit,
  addBreadcrumb: mockSentryAddBreadcrumb,
  captureException: mockSentryCaptureException,
  setUser: mockSentrySetUser,
  setTag: mockSentrySetTag,
  withScope: mockSentryWithScope,
  isInitialized: mockSentryIsInitialized,
  setupExpressErrorHandler: mockSetupExpressErrorHandler,
  httpIntegration: vi.fn(() => ({})),
  expressIntegration: vi.fn(() => ({})),
  nativeNodeFetchIntegration: vi.fn(() => ({})),
}));

const mockConfigObj: any = {
  config: {
    sentry: {
      dsn: 'https://key@sentry.io/project',
      environment: 'test',
      tracesSampleRate: 0.1,
    },
  },
};

vi.mock('../../config.js', () => mockConfigObj);
vi.mock('../../utils/logger.js', () => ({ rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) } }));

describe('monitoring/sentry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('initSentry', () => {
    it('skips init when DSN is not configured', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = '';
      const mod = await import('../../monitoring/sentry.js');
      mod.initSentry();
      expect(mockSentryInit).not.toHaveBeenCalled();
    });

    it('initializes Sentry with DSN', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      mod.initSentry();
      expect(mockSentryInit).toHaveBeenCalled();
    });
  });

  describe('addBreadcrumb', () => {
    it('adds a breadcrumb when DSN is configured', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      mod.addBreadcrumb('test', 'test message', { key: 'val' });
      expect(mockSentryAddBreadcrumb).toHaveBeenCalled();
    });

    it('skips when DSN is missing', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = '';
      const mod = await import('../../monitoring/sentry.js');
      mod.addBreadcrumb('test', 'msg');
      expect(mockSentryAddBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe('captureError', () => {
    it('captures exception with context', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      await mod.captureError(new Error('test'), { repo: 'test/repo' });
      expect(mockSentryCaptureException).toHaveBeenCalled();
    });
  });

  describe('setUserContext', () => {
    it('sets Sentry user', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      mod.setUserContext(42, 'owner/repo');
      expect(mockSentrySetUser).toHaveBeenCalledWith({ id: '42', username: 'owner/repo' });
    });
  });

  describe('setTag', () => {
    it('sets a Sentry tag', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      mod.setTag('service', 'stas');
      expect(mockSentrySetTag).toHaveBeenCalledWith('service', 'stas');
    });
  });

  describe('setupSentryExpressErrorHandler', () => {
    it('sets up error handler on Express app', async () => {
      vi.resetModules();
      mockConfigObj.config.sentry.dsn = 'https://key@sentry.io/project';
      const mod = await import('../../monitoring/sentry.js');
      const app = { use: vi.fn() } as any;
      mod.setupSentryExpressErrorHandler(app);
      expect(mockSetupExpressErrorHandler).toHaveBeenCalledWith(app);
    });
  });
});
