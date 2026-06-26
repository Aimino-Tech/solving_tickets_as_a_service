/**
 * Tests for Visual Verification Gate (AIM-2036).
 *
 * - AC1: playwright captures screenshots of all changed UI routes
 * - AC2: pixelmatch compares before/after with configurable threshold
 * - AC3: Pixel mismatch > 5% configurable → FAIL with diff image
 * - AC4: oc-vision integration as alternative verification method
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  VisualVerificationConfig,
  VisualVerificationSummary,
} from '../../agent/visualVerificationGate.js';

// Mocks — all defined via vi.hoisted() so they're hoisted before vi.mock factories
const mockScreenshot = vi.hoisted(() => vi.fn());
const mockGoto = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockAddCookies = vi.hoisted(() => vi.fn());
const mockPixelmatchDefault = vi.hoisted(() => vi.fn());
const mockPngRead = vi.hoisted(() => vi.fn());
const mockPngWrite = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockCreateHash = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Shared mock objects
const mockPage = vi.hoisted(() => ({
  screenshot: mockScreenshot,
  goto: mockGoto,
  setDefaultTimeout: vi.fn(),
}));

const mockContext = vi.hoisted(() => ({
  newPage: vi.fn().mockResolvedValue(mockPage),
  addCookies: mockAddCookies,
}));

const mockBrowser = vi.hoisted(() => ({
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: mockClose,
}));

vi.mock('@playwright/test', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

vi.mock('pixelmatch', () => ({
  default: mockPixelmatchDefault,
}));

class MockPNG {
  constructor(options: { width: number; height: number }) {
    this.width = options.width;
    this.height = options.height;
    this.data = Buffer.alloc(options.width * options.height * 4);
  }
  declare width: number;
  declare height: number;
  declare data: Buffer;
  static sync = {
    read: mockPngRead,
    write: mockPngWrite,
  };
}

vi.mock('pngjs', () => ({
  default: {
    PNG: MockPNG,
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:crypto', () => ({
  createHash: mockCreateHash,
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

// Import after mocks
const { runVisualVerification, generateReport, isVisualVerificationAvailable } = await import(
  '../../agent/visualVerificationGate.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig: VisualVerificationConfig = {
  baseUrl: 'http://localhost:3000',
  routes: ['/dashboard', '/settings'],
  outputDir: '/tmp/visual-verify-output',
  threshold: 0.05,
};

function setupMocksForSuccess() {
  mockGoto.mockResolvedValue(undefined);
  mockScreenshot.mockResolvedValue(undefined);
  mockPngRead.mockReturnValue({
    data: Buffer.alloc(1280 * 720 * 4, 128),
    width: 1280,
    height: 720,
  });
  mockPngWrite.mockReturnValue(Buffer.alloc(100));
  mockPixelmatchDefault.mockReturnValue(0);
}

function setupMocksForMismatch(mismatchPixels: number) {
  mockGoto.mockResolvedValue(undefined);
  mockScreenshot.mockResolvedValue(undefined);
  mockPngRead.mockReturnValue({
    data: Buffer.alloc(1280 * 720 * 4, 128),
    width: 1280,
    height: 720,
  });
  mockPngWrite.mockReturnValue(Buffer.alloc(100));
  mockPixelmatchDefault.mockReturnValue(mismatchPixels);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isVisualVerificationAvailable', () => {
  it('returns true when pixelmatch and playwright are available', async () => {
    const available = await isVisualVerificationAvailable();
    expect(available).toBe(true);
  });
});

describe('runVisualVerification (AC1: Playwright screenshots)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures screenshots for all configured routes — AC1', async () => {
    setupMocksForSuccess();
    const config = { ...defaultConfig, routes: ['/dashboard', '/settings', '/profile'] };

    const result = await runVisualVerification(config);

    expect(mockGoto).toHaveBeenCalledTimes(6);
    expect(mockScreenshot).toHaveBeenCalledTimes(6);
    expect(result.results).toHaveLength(3);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('handles single route gracefully', async () => {
    setupMocksForSuccess();
    const config = { ...defaultConfig, routes: ['/health'] };

    const result = await runVisualVerification(config);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].route).toBe('/health');
  });

  it('handles root route (/)', async () => {
    setupMocksForSuccess();
    const config = { ...defaultConfig, routes: ['/'] };

    const result = await runVisualVerification(config);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].route).toBe('/');
  });

  it('always closes browser in finally block', async () => {
    setupMocksForSuccess();
    mockGoto
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Navigation failed'));

    const config = { ...defaultConfig, routes: ['/dashboard', '/settings'] };

    await runVisualVerification(config);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});

describe('pixelmatch diffing (AC2: before/after comparison)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when images are identical (0% mismatch) — AC2', async () => {
    setupMocksForSuccess();
    const config = { ...defaultConfig, routes: ['/dashboard'] };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(true);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[0].mismatchPercentage).toBe(0);
  });

  it('fails when mismatch exceeds threshold — AC3', async () => {
    setupMocksForMismatch(50000);
    const config = { ...defaultConfig, routes: ['/dashboard'], threshold: 0.05 };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(false);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].mismatchPercentage).toBeGreaterThan(5);
    expect(result.results[0].diffImagePath).toBeDefined();
  });

  it('passes when mismatch is below threshold', async () => {
    setupMocksForMismatch(1000);
    const config = { ...defaultConfig, routes: ['/dashboard'], threshold: 0.05 };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(true);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[0].mismatchPercentage).toBeLessThan(5);
  });

  it('respects configurable threshold — AC2', async () => {
    setupMocksForMismatch(20000);
    const strictConfig = { ...defaultConfig, routes: ['/dashboard'], threshold: 0.01 };
    const lenientConfig = { ...defaultConfig, routes: ['/dashboard'], threshold: 0.05 };

    const strictResult = await runVisualVerification(strictConfig);
    const lenientResult = await runVisualVerification(lenientConfig);

    expect(strictResult.results[0].passed).toBe(false);
    expect(lenientResult.results[0].passed).toBe(true);
  });

  it('generates diff image when mismatch > 0 — AC3', async () => {
    setupMocksForMismatch(50000);
    const config = { ...defaultConfig, routes: ['/dashboard'] };

    const result = await runVisualVerification(config);

    expect(result.results[0].diffImagePath).toBeDefined();
    expect(result.results[0].diffImagePath).toContain('diff');
  });

  it('does not generate diff image when images match exactly', async () => {
    setupMocksForSuccess();
    const config = { ...defaultConfig, routes: ['/dashboard'] };

    const result = await runVisualVerification(config);

    expect(result.results[0].diffImagePath).toBeUndefined();
  });
});

describe('oc-vision integration (AC4: alternative method)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports oc-vision as alternative verification method — AC4', async () => {
    setupMocksForSuccess();
    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard'],
      useOcVision: true,
    };

    const result = await runVisualVerification(config);

    expect(result).toBeDefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].route).toBe('/dashboard');
  });

  it('oc-vision mode returns results for all routes', async () => {
    setupMocksForSuccess();
    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard', '/settings'],
      useOcVision: true,
    };

    const result = await runVisualVerification(config);

    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r).toHaveProperty('route');
      expect(r).toHaveProperty('beforeScreenshotPath');
      expect(r).toHaveProperty('afterScreenshotPath');
    }
  });
});

describe('generateReport', () => {
  it('generates PASS report when all pass', () => {
    const summary: VisualVerificationSummary = {
      passed: true,
      passedCount: 2,
      failedCount: 0,
      totalDurationMs: 1200,
      threshold: 0.05,
      results: [
        {
          route: '/dashboard',
          passed: true,
          mismatchPercentage: 0.02,
          beforeScreenshotPath: '/tmp/before/dashboard.png',
          afterScreenshotPath: '/tmp/after/dashboard.png',
          durationMs: 600,
        },
        {
          route: '/settings',
          passed: true,
          mismatchPercentage: 0.01,
          beforeScreenshotPath: '/tmp/before/settings.png',
          afterScreenshotPath: '/tmp/after/settings.png',
          durationMs: 600,
        },
      ],
    };

    const report = generateReport(summary);

    expect(report).toContain('PASS');
    expect(report).toContain('/dashboard');
    expect(report).toContain('/settings');
    expect(report).toContain('Threshold: 5.0%');
    expect(report).toContain('0.02%');
    expect(report).toContain('0.01%');
  });

  it('generates FAIL report with diff image paths', () => {
    const summary: VisualVerificationSummary = {
      passed: false,
      passedCount: 0,
      failedCount: 1,
      totalDurationMs: 800,
      threshold: 0.05,
      results: [
        {
          route: '/broken-page',
          passed: false,
          mismatchPercentage: 12.5,
          beforeScreenshotPath: '/tmp/before/broken-page.png',
          afterScreenshotPath: '/tmp/after/broken-page.png',
          diffImagePath: '/tmp/diff/broken-page-diff.png',
          durationMs: 800,
        },
      ],
    };

    const report = generateReport(summary);

    expect(report).toContain('FAIL');
    expect(report).toContain('/broken-page');
    expect(report).toContain('12.50%');
    expect(report).toContain('broken-page-diff.png');
  });

  it('includes oc-vision report path when available', () => {
    const summary: VisualVerificationSummary = {
      passed: true,
      passedCount: 1,
      failedCount: 0,
      totalDurationMs: 500,
      threshold: 0.05,
      ocVisionReportPath: '/tmp/oc-vision/report.json',
      results: [
        {
          route: '/dashboard',
          passed: true,
          mismatchPercentage: 0,
          beforeScreenshotPath: '/tmp/oc-vision/dashboard.png',
          afterScreenshotPath: '/tmp/oc-vision/dashboard.png',
          durationMs: 500,
        },
      ],
    };

    const report = generateReport(summary);

    expect(report).toContain('Oc-Vision');
    expect(report).toContain('/tmp/oc-vision/report.json');
  });

  it('includes error messages when present', () => {
    const summary: VisualVerificationSummary = {
      passed: false,
      passedCount: 0,
      failedCount: 1,
      totalDurationMs: 300,
      threshold: 0.05,
      results: [
        {
          route: '/broken',
          passed: false,
          mismatchPercentage: 100,
          beforeScreenshotPath: '',
          afterScreenshotPath: '',
          error: 'Navigation timeout exceeded',
          durationMs: 300,
        },
      ],
    };

    const report = generateReport(summary);

    expect(report).toContain('Navigation timeout exceeded');
  });
});

describe('configuration edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults threshold to 5% when not provided', async () => {
    setupMocksForSuccess();
    const config: VisualVerificationConfig = {
      baseUrl: 'http://localhost:3000',
      routes: ['/dashboard'],
      outputDir: '/tmp/test',
    };

    const result = await runVisualVerification(config);

    expect(result.threshold).toBe(0.05);
  });

  it('uses custom viewport dimensions when provided', async () => {
    setupMocksForSuccess();
    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard'],
      viewportWidth: 1920,
      viewportHeight: 1080,
    };

    await runVisualVerification(config);

    expect(mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 1920, height: 1080 },
      }),
    );
  });

  it('handles empty routes list', async () => {
    setupMocksForSuccess();
    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: [],
    };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.passedCount).toBe(0);
  });

  it('handles navigation errors gracefully', async () => {
    setupMocksForSuccess();
    mockGoto.mockRejectedValue(new Error('Connection refused'));

    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard'],
    };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(false);
    expect(result.results[0].error).toBeDefined();
    expect(result.results[0].error).toContain('Connection refused');
  });

  it('loads session cookies when path is provided', async () => {
    setupMocksForSuccess();
    mockReadFile.mockResolvedValue(
      JSON.stringify([{ name: 'token', value: 'abc', domain: 'localhost' }]),
    );

    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard'],
      sessionCookiePath: '/tmp/cookies.json',
    };

    await runVisualVerification(config);

    expect(mockAddCookies).toHaveBeenCalled();
    expect(mockAddCookies).toHaveBeenCalledWith([
      { name: 'token', value: 'abc', domain: 'localhost' },
    ]);
  });

  it('handles pixelmatch errors', async () => {
    mockGoto.mockResolvedValue(undefined);
    mockScreenshot.mockResolvedValue(undefined);
    mockPngRead.mockReturnValue({
      data: Buffer.alloc(1280 * 720 * 4, 128),
      width: 1280,
      height: 720,
    });
    mockPixelmatchDefault.mockImplementation(() => {
      throw new Error('pixelmatch failed');
    });

    const config: VisualVerificationConfig = {
      ...defaultConfig,
      routes: ['/dashboard'],
    };

    const result = await runVisualVerification(config);

    expect(result.passed).toBe(false);
    expect(result.results[0].error).toContain('pixelmatch failed');
  });
});
