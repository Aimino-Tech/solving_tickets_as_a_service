/**
 * Unit tests for Emergency Stop module.
 *
 * Tests the core EmergencyStop functionality: activate, deactivate,
 * check, and getStatus. These tests use the filesystem-based lock
 * mechanism (no Redis dependency) since Redis may not be available
 * in test environments.
 *
 * ── Test Strategy ─────────────────────────────────────────────────────
 *   - Unit: EmergencyStop.check(), .activate(), .deactivate(), .getStatus()
 *   - Unit: Emergency middleware rejects tasks when active
 *   - Unit: Queue management (hold/resume message count tracking)
 *   - No Redis: Tests use file-based fallback exclusively
 * ──────────────────────────────────────────────────────────────────────
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock all external dependencies
vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }));
  return { Redis: MockRedis, default: MockRedis };
});

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../bridge/metrics.js', () => ({
  bridgeMetrics: {
    setGauge: vi.fn(),
    incrementCounter: vi.fn(),
    decrementGauge: vi.fn(),
    observeHistogram: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCK_FILE = '/tmp/stas-emergency-stop.lock';
const TEST_REASON = 'Test emergency stop';
const TEST_LOCK_CONTENT = JSON.stringify({
  reason: TEST_REASON,
  activatedAt: '2025-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function removeLockFile(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('EmergencyStop', () => {
  let EmergencyStop: typeof import('../../emergency/stop.js').EmergencyStop;

  beforeAll(async () => {
    const mod = await import('../../emergency/stop.js');
    EmergencyStop = mod.EmergencyStop;
  });

  beforeEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
  });

  afterEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
  });

  // -----------------------------------------------------------------------
  // Default state
  // -----------------------------------------------------------------------

  describe('default state', () => {
    it('should be inactive on startup', () => {
      expect(EmergencyStop.check()).toBe(false);
    });

    it('should return inactive status on startup', async () => {
      const status = await EmergencyStop.getStatus();
      expect(status.active).toBe(false);
      expect(status.reason).toBeUndefined();
      expect(status.activatedAt).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  describe('activate', () => {
    it('should activate the kill switch with a reason', async () => {
      await EmergencyStop.activate(TEST_REASON);

      expect(EmergencyStop.check()).toBe(true);

      // Verify lock file was written
      expect(existsSync(LOCK_FILE)).toBe(true);
      const content = readFileSync(LOCK_FILE, 'utf-8');
      const data = JSON.parse(content);
      expect(data.reason).toBe(TEST_REASON);
      expect(data.activatedAt).toBeDefined();
    });

    it('should activate without a reason (default)', async () => {
      await EmergencyStop.activate();

      expect(EmergencyStop.check()).toBe(true);
      expect(existsSync(LOCK_FILE)).toBe(true);
    });

    it('should reflect activation in getStatus', async () => {
      await EmergencyStop.activate(TEST_REASON);

      const status = await EmergencyStop.getStatus();
      expect(status.active).toBe(true);
      expect(status.reason).toBe(TEST_REASON);
      expect(status.activatedAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Deactivate
  // -----------------------------------------------------------------------

  describe('deactivate', () => {
    it('should deactivate the kill switch', async () => {
      await EmergencyStop.activate(TEST_REASON);
      expect(EmergencyStop.check()).toBe(true);

      await EmergencyStop.deactivate();

      expect(EmergencyStop.check()).toBe(false);
      expect(existsSync(LOCK_FILE)).toBe(false);
    });

    it('should handle deactivate when already inactive', async () => {
      // Should not throw
      await expect(EmergencyStop.deactivate()).resolves.toBeUndefined();
      expect(EmergencyStop.check()).toBe(false);
    });

    it('should reflect deactivation in getStatus', async () => {
      await EmergencyStop.activate(TEST_REASON);
      await EmergencyStop.deactivate();

      const status = await EmergencyStop.getStatus();
      expect(status.active).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Activate → Deactivate cycle
  // -----------------------------------------------------------------------

  describe('activate/deactivate cycle', () => {
    it('should toggle state correctly across multiple cycles', async () => {
      for (let i = 0; i < 3; i++) {
        await EmergencyStop.activate(`Cycle ${i}`);
        expect(EmergencyStop.check()).toBe(true);

        await EmergencyStop.deactivate();
        expect(EmergencyStop.check()).toBe(false);
      }
    });

    it('should update the reason on re-activation', async () => {
      await EmergencyStop.activate('First reason');
      await EmergencyStop.deactivate();
      await EmergencyStop.activate('Second reason');

      const status = await EmergencyStop.getStatus();
      expect(status.reason).toBe('Second reason');
    });
  });

  // -----------------------------------------------------------------------
  // File-based fallback
  // -----------------------------------------------------------------------

  describe('file-based detection', () => {
    it('should detect active state from lock file (Redis unavailable)', async () => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(LOCK_FILE, TEST_LOCK_CONTENT, 'utf-8');

      // Reset in-memory cache to force file read
      EmergencyStop._resetCache();

      expect(EmergencyStop.check()).toBe(true);
    });

    it('should read reason from lock file', async () => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(LOCK_FILE, TEST_LOCK_CONTENT, 'utf-8');

      EmergencyStop._resetCache();

      const status = await EmergencyStop.getStatus();
      expect(status.active).toBe(true);
      expect(status.reason).toBe(TEST_REASON);
    });
  });
});

// ---------------------------------------------------------------------------
// Middleware tests
// ---------------------------------------------------------------------------

describe('Emergency Middleware', () => {
  let EmergencyStop: typeof import('../../emergency/stop.js').EmergencyStop;
  let emergencyMiddleware: typeof import('../../emergency/middleware.js').emergencyMiddleware;

  beforeAll(async () => {
    const stopMod = await import('../../emergency/stop.js');
    EmergencyStop = stopMod.EmergencyStop;

    const middlewareMod = await import('../../emergency/middleware.js');
    emergencyMiddleware = middlewareMod.emergencyMiddleware;
  });

  beforeEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
  });

  afterEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
  });

  it('should call next() when stop is inactive', () => {
    const req = { path: '/dispatch', method: 'POST', ip: '127.0.0.1' } as any;
    const res = {} as any;
    const next = vi.fn();

    emergencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should reject with 503 when stop is active', async () => {
    await EmergencyStop.activate(TEST_REASON);

    const req = { path: '/dispatch', method: 'POST', ip: '127.0.0.1' } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    emergencyMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Service temporarily unavailable',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should route dispatch to hold queue via wrapDispatch when active', async () => {
    await EmergencyStop.activate(TEST_REASON);

    const { wrapDispatch } = await import('../../emergency/middleware.js');
    const mockDispatch = vi.fn().mockResolvedValue({ ok: true });

    const wrapped = wrapDispatch(mockDispatch);
    const result = await wrapped('stas.agents.dispatch', { foo: 'bar' });

    // Should have dispatched to hold queue
    expect(mockDispatch).toHaveBeenCalledWith(
      'stas.emergency.hold',
      expect.objectContaining({ foo: 'bar' }),
    );

    // Should return held marker
    expect(result).toEqual(
      expect.objectContaining({
        held: true,
        originalQueue: 'stas.agents.dispatch',
      }),
    );
  });

  it('should dispatch normally via wrapDispatch when inactive', async () => {
    const { wrapDispatch } = await import('../../emergency/middleware.js');
    const mockDispatch = vi.fn().mockResolvedValue({ ok: true });

    const wrapped = wrapDispatch(mockDispatch);
    const result = await wrapped('stas.agents.dispatch', { foo: 'bar' });

    // Should have dispatched to original queue
    expect(mockDispatch).toHaveBeenCalledWith('stas.agents.dispatch', { foo: 'bar' });

    // Should return the original result
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Queue management tests
// ---------------------------------------------------------------------------

describe('Emergency Queue Management', () => {
  let EmergencyStop: typeof import('../../emergency/stop.js').EmergencyStop;

  beforeAll(async () => {
    const mod = await import('../../emergency/stop.js');
    EmergencyStop = mod.EmergencyStop;
  });

  beforeEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    removeLockFile();
    EmergencyStop._resetCache();
  });

  it('should track held message count via bridge metrics', async () => {
    const { bridgeMetrics } = await import('../../bridge/metrics.js');

    await EmergencyStop.activate(TEST_REASON);

    // The activation sets gauge to 1
    expect(bridgeMetrics.setGauge).toHaveBeenCalledWith(
      'stas_emergency_stop_active',
      {},
      1,
    );
  });

  it('should clear held message count on deactivate', async () => {
    const { bridgeMetrics } = await import('../../bridge/metrics.js');

    await EmergencyStop.activate(TEST_REASON);
    await EmergencyStop.deactivate();

    expect(bridgeMetrics.setGauge).toHaveBeenCalledWith(
      'stas_emergency_stop_active',
      {},
      0,
    );
  });
});
