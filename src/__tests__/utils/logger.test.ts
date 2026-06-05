/**
 * Unit tests for src/utils/logger.ts — Pino logger setup.
 *
 * The logger module creates a root pino logger at import time and exports
 * a `jobLogger()` factory that returns child loggers with context fields.
 *
 * We mock the `pino` package entirely so no real logger or transport
 * (pino-pretty) is instantiated during tests.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mock references ─────────────────────────────────────────────────
// These must be defined via vi.hoisted so they exist when the vi.mock factory runs.

const { mockPinoLogger, mockPino } = vi.hoisted(() => {
  const logger = {
    level: "info",
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  };

  const pino = vi.fn(() => logger) as ReturnType<typeof vi.fn> & {
    stdSerializers: { err: ReturnType<typeof vi.fn> };
  };
  pino.stdSerializers = { err: vi.fn() };

  return { mockPinoLogger: logger, mockPino: pino };
});

vi.mock("pino", () => ({
  default: mockPino,
  stdSerializers: { err: vi.fn() },
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe("logger", () => {
  beforeAll(() => {
    // Silence pino-pretty transport issue in test environment by ensuring
    // NODE_ENV is predictable.
    vi.stubEnv("NODE_ENV", "test");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  // Re-apply the default LOG_LEVEL before each test so individual tests
  // that stub it don't leak into subsequent tests.
  beforeEach(() => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("NODE_ENV", "test");

    // Ensure the pino mock returns our logger object (restoreMocks may have
    // cleared the implementation between tests).
    mockPino.mockImplementation(() => mockPinoLogger);
    mockPinoLogger.child = vi.fn().mockReturnThis();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── rootLogger ─────────────────────────────────────────────────────────

  describe("rootLogger", () => {
    it("is created by calling pino() on module import", async () => {
      vi.resetModules();
      await import("../../utils/logger.js");

      expect(mockPino).toHaveBeenCalledOnce();
      expect(mockPino).toHaveBeenCalledWith(
        expect.objectContaining({
          level: expect.any(String),
        }),
      );
    });

    it("is configured with a redact block", async () => {
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options).toHaveProperty("redact");
      expect(options.redact.paths).toContain('req.headers["x-hub-signature-256"]');
    });

    it("includes serializers for req, res, and err", async () => {
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options).toHaveProperty("serializers");
      expect(options.serializers).toHaveProperty("req");
      expect(options.serializers).toHaveProperty("res");
      expect(options.serializers).toHaveProperty("err");
    });

    it("uses pino-pretty transport when NODE_ENV !== 'production'", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options.transport).toBeDefined();
      expect(options.transport.target).toBe("pino-pretty");
    });

    it("omits transport when NODE_ENV is 'production'", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options.transport).toBeUndefined();
    });
  });

  // ── LOG_LEVEL env var ──────────────────────────────────────────────────

  describe("LOG_LEVEL configuration", () => {
    it("defaults to 'info' when LOG_LEVEL is not set", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("NODE_ENV", "test");
      // Intentionally NOT stubbing LOG_LEVEL; let it be undefined.
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options.level).toBe("info");
    });

    it("reads LOG_LEVEL from environment", async () => {
      vi.stubEnv("LOG_LEVEL", "debug");
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options.level).toBe("debug");
    });

    it("accepts 'warn' log level", async () => {
      vi.stubEnv("LOG_LEVEL", "warn");
      vi.resetModules();
      await import("../../utils/logger.js");

      const options = mockPino.mock.calls[0][0];
      expect(options.level).toBe("warn");
    });
  });

  // ── jobLogger ──────────────────────────────────────────────────────────

  describe("jobLogger()", () => {
    it("returns a child logger with context fields", async () => {
      vi.resetModules();
      const { jobLogger } = await import("../../utils/logger.js");

      const child = jobLogger({
        jobId: "job-001",
        installationId: 555,
        repo: "owner/test-repo",
        issueNumber: 42,
      });

      expect(mockPinoLogger.child).toHaveBeenCalledWith({
        jobId: "job-001",
        installationId: 555,
        repo: "owner/test-repo",
        issueNumber: 42,
      });
    });

    it("works with a partial set of fields", async () => {
      vi.resetModules();
      const { jobLogger } = await import("../../utils/logger.js");

      jobLogger({ jobId: "job-002" });
      expect(mockPinoLogger.child).toHaveBeenCalledWith({
        jobId: "job-002",
      });
    });
  });

  // ── Exports ─────────────────────────────────────────────────────────────

  describe("exports", () => {
    it("exports rootLogger and jobLogger", async () => {
      vi.resetModules();
      const mod = await import("../../utils/logger.js");

      expect(mod).toHaveProperty("rootLogger");
      expect(mod).toHaveProperty("jobLogger");
      expect(typeof mod.jobLogger).toBe("function");
    });
  });
});
