/**
 * Unit tests for src/config.ts — Zod environment validation.
 *
 * Strategy:
 *   The config module runs `envSchema.safeParse(process.env)` at import time.
 *   We mock side-effect modules ("dotenv/config", the logger) and set valid
 *   baseline env vars so the module loads successfully.  Most tests exercise
 *   `requireConfig()` which re-parses process.env on every call, allowing us
 *   to vary env vars per test without reloading the module.
 *
 *   Module-level validation (process.exit) is tested separately via a
 *   dynamic import block after resetModules.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module-level mocks ──────────────────────────────────────────────────────
// Prevent .env loading and keep the logger quiet during tests.

vi.mock('dotenv/config');

const mockRootLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  rootLogger: mockRootLogger,
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe('config', () => {
  let exitMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let configModule: any;

  beforeAll(async () => {
    // Baseline env vars — every field the Zod schema requires to pass.
    vi.stubEnv('GITHUB_APP_ID', 'test-app-123');
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret-456');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');

    // Override vitest's NODE_ENV=test so the module-level default is "development"
    vi.stubEnv('NODE_ENV', 'development');

    // Trap process.exit so module-level validation failures don't kill the runner.
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {
      // no-op
    }) as any);

    configModule = await import('../config.js');
  });

  afterAll(() => {
    exitMock.mockRestore();
    vi.unstubAllEnvs();
  });

  // ── Module-level config object ──────────────────────────────────────────

  describe('module-level config object', () => {
    it('builds config from env vars', () => {
      const cfg = configModule.config;
      expect(cfg.github.appId).toBe('test-app-123');
      expect(cfg.github.webhookSecret).toBe('test-webhook-secret-456');
    });

    it('parses PORT as a number (default 3000)', () => {
      expect(configModule.config.port).toBe(3000);
      expect(typeof configModule.config.port).toBe('number');
    });

    it('defaults WORKER_CONCURRENCY to 2', () => {
      expect(configModule.config.queue.workerConcurrency).toBe(2);
    });

    it("defaults STAS_LABEL to 'stas:fix'", () => {
      expect(configModule.config.stas.label).toBe('stas:fix');
    });

    it("defaults LOG_LEVEL to 'info'", () => {
      expect(configModule.config.logLevel).toBe('info');
    });

    it("defaults NODE_ENV to 'development'", () => {
      expect(configModule.config.nodeEnv).toBe('development');
    });

    it("defaults RUN_MODE to 'both'", () => {
      expect(configModule.config.runMode).toBe('both');
    });

    it('defaults REDIS_URL to redis://localhost:6379', () => {
      expect(configModule.config.queue.redisUrl).toBe('redis://localhost:6379');
    });

    it('defaults OPENCODE_URL to http://localhost:4096', () => {
      expect(configModule.config.opencode.url).toBe('http://localhost:4096');
    });

    it("defaults FALLBACK_MODELS to gpt-4o,claude-haiku", () => {
      expect(configModule.config.opencode.fallbackModels).toEqual(["gpt-4o", "claude-haiku"]);
    });

    it("defaults FIX_TIMEOUT_MS to 600000", () => {
      expect(configModule.config.fixTimeoutMs).toBe(600_000);
    });

    it("defaults phase timeouts correctly", () => {
      expect(configModule.config.phaseTimeouts.triage).toBe(30_000);
      expect(configModule.config.phaseTimeouts.sandboxBoot).toBe(300_000);
      expect(configModule.config.phaseTimeouts.openCodeAgent).toBe(600_000);
      expect(configModule.config.phaseTimeouts.prCreation).toBe(30_000);
    });

    it("defaults QUEUE_MAX_RETRIES to 4", () => {
      expect(configModule.config.queue.maxRetries).toBe(4);
    });

    it("defaults QUEUE_RETRY_DELAYS to [30000, 120000, 300000, 900000]", () => {
      expect(configModule.config.queue.retryDelays).toEqual([30000, 120000, 300000, 900000]);
    });

    it("defaults DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY to false", () => {
      expect(configModule.config.stas.devSkipWebhookVerify).toBe(false);
    });

    it("defaults BOT_NAME to 'STAS'", () => {
      expect(configModule.config.stas.botName).toBe('STAS');
    });
  });

  // ── requireConfig() ─────────────────────────────────────────────────────

  describe('requireConfig()', () => {
    // Re-apply baseline env vars before each requireConfig test, because
    // individual tests may have removed them via unstubAllEnvs.
    beforeEach(() => {
      vi.stubEnv('GITHUB_APP_ID', 'test-app-123');
      vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-webhook-secret-456');
      vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'test-private-key');
    });

    afterEach(() => {
      // Wipe any env stubs the current test set up so the next test starts clean.
      vi.unstubAllEnvs();
    });

    it('returns the config object when all required env vars are present', () => {
      const cfg = configModule.requireConfig();
      expect(cfg.github.appId).toBe('test-app-123');
      expect(cfg.github.webhookSecret).toBe('test-webhook-secret-456');
      expect(cfg.stas.label).toBe('stas:fix');
    });

    it('throws when GITHUB_APP_ID is empty', () => {
      vi.stubEnv('GITHUB_APP_ID', '');
      expect(() => configModule.requireConfig()).toThrow(/GITHUB_APP_ID/);
    });

    it('throws when GITHUB_WEBHOOK_SECRET is empty', () => {
      vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
      expect(() => configModule.requireConfig()).toThrow(/GITHUB_WEBHOOK_SECRET/);
    });

    it('parses PORT env var as number', () => {
      vi.stubEnv('PORT', '8080');
      const cfg = configModule.requireConfig();
      expect(cfg.port).toBe(8080);
      expect(typeof cfg.port).toBe('number');
    });

    it('rejects PORT with decimal value (int() validation)', () => {
      vi.stubEnv('PORT', '3000.9');
      expect(() => configModule.requireConfig()).toThrow(/PORT/);
    });

    it('rejects PORT outside valid range', () => {
      vi.stubEnv('PORT', '70000');
      expect(() => configModule.requireConfig()).toThrow();
    });

    it('defaults WORKER_CONCURRENCY to 2 when not set', () => {
      const cfg = configModule.requireConfig();
      expect(cfg.queue.workerConcurrency).toBe(2);
    });

    it('parses WORKER_CONCURRENCY as number when set', () => {
      vi.stubEnv('WORKER_CONCURRENCY', '5');
      const cfg = configModule.requireConfig();
      expect(cfg.queue.workerConcurrency).toBe(5);
    });

    it("defaults STAS_LABEL to 'stas:fix' when not set", () => {
      const cfg = configModule.requireConfig();
      expect(cfg.stas.label).toBe('stas:fix');
    });

    it('accepts custom STAS_LABEL', () => {
      vi.stubEnv('STAS_LABEL', 'custom:label');
      const cfg = configModule.requireConfig();
      expect(cfg.stas.label).toBe('custom:label');
    });

    it("defaults LOG_LEVEL to 'info' when not set", () => {
      const cfg = configModule.requireConfig();
      expect(cfg.logLevel).toBe('info');
    });

    it('validates LOG_LEVEL enum — rejects invalid value', () => {
      vi.stubEnv('LOG_LEVEL', 'verbose');
      expect(() => configModule.requireConfig()).toThrow(/LOG_LEVEL/);
    });

    it('accepts valid LOG_LEVEL values (debug, info, warn, error, fatal)', () => {
      for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
        vi.stubEnv('LOG_LEVEL', level);
        const cfg = configModule.requireConfig();
        expect(cfg.logLevel).toBe(level);
      }
    });

    it("defaults NODE_ENV to 'development' when not set", () => {
      // Zod default only applies when NODE_ENV is truly undefined in process.env.
      // Temporarily remove to test the default, then restore.
      const orig = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        const cfg = configModule.requireConfig();
        expect(cfg.nodeEnv).toBe('development');
      } finally {
        process.env.NODE_ENV = orig;
      }
    });

    it('validates NODE_ENV enum — rejects invalid value', () => {
      vi.stubEnv('NODE_ENV', 'staging');
      expect(() => configModule.requireConfig()).toThrow(/NODE_ENV/);
    });

    it('accepts valid NODE_ENV values (development, production, test)', () => {
      for (const env of ['development', 'production', 'test']) {
        vi.stubEnv('NODE_ENV', env);
        const cfg = configModule.requireConfig();
        expect(cfg.nodeEnv).toBe(env);
      }
    });

    it("coerces DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY from string 'true'", () => {
      vi.stubEnv('DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY', 'true');
      const cfg = configModule.requireConfig();
      expect(cfg.stas.devSkipWebhookVerify).toBe(true);
    });

    it('coerces DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY — non-empty string is truthy', () => {
      vi.stubEnv('DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY', 'false');
      const cfg = configModule.requireConfig();
      // z.coerce.boolean uses Boolean("false") which is true (non-empty string)
      expect(cfg.stas.devSkipWebhookVerify).toBe(true);
    });

    it('throws with a descriptive error message listing all failures', () => {
      vi.stubEnv('GITHUB_APP_ID', '');
      vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
      const e = () => configModule.requireConfig();
      expect(e).toThrow('Invalid environment configuration:');
      expect(e).toThrow(/GITHUB_APP_ID/);
      expect(e).toThrow(/GITHUB_WEBHOOK_SECRET/);
    });

    it('accepts GITHUB_APP_PRIVATE_KEY_PATH instead of GITHUB_APP_PRIVATE_KEY', () => {
      // Unset GITHUB_APP_PRIVATE_KEY (it's optional)
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      vi.stubEnv('GITHUB_APP_PRIVATE_KEY_PATH', '/etc/secrets/key.pem');
      const cfg = configModule.requireConfig();
      expect(cfg.github.privateKeyPath).toBe('/etc/secrets/key.pem');
    });
  });

  // ── Module-level validation (process.exit) ──────────────────────────────

  describe('module-level validation on import', () => {
    it('calls process.exit(1) when required env vars are missing', async () => {
      vi.resetModules();

      // Clear all env stubs so the required vars are absent
      vi.unstubAllEnvs();

      const localExitMock = vi.spyOn(process, 'exit').mockImplementation((() => {
        // Throw to prevent execution from continuing to buildConfig(undefined)
        throw new Error('process.exit was called');
      }) as any);

      await expect(import('../config.js')).rejects.toThrow('process.exit was called');
      expect(localExitMock).toHaveBeenCalledWith(1);
      localExitMock.mockRestore();
    });
  });

  // ── Config type ─────────────────────────────────────────────────────────

  describe('Config type', () => {
    it('exports a Config type that matches the config shape', () => {
      const cfg = configModule.config;
      // Structural verification — the type contract should match the runtime shape.
      expect(cfg).toHaveProperty("port");
      expect(cfg).toHaveProperty("runMode");
      expect(cfg).toHaveProperty("logLevel");
      expect(cfg).toHaveProperty("nodeEnv");
      expect(cfg).toHaveProperty("github");
      expect(cfg).toHaveProperty("queue");
      expect(cfg).toHaveProperty("opencode");
      expect(cfg).toHaveProperty("openai");
      expect(cfg).toHaveProperty("e2b");
      expect(cfg).toHaveProperty("stas");
      expect(cfg).toHaveProperty("fixTimeoutMs");
      expect(cfg).toHaveProperty("phaseTimeouts");

      // Nested sections
      expect(cfg.github).toHaveProperty("appId");
      expect(cfg.github).toHaveProperty("webhookSecret");
      expect(cfg.queue).toHaveProperty("redisUrl");
      expect(cfg.queue).toHaveProperty("workerConcurrency");
      expect(cfg.queue).toHaveProperty("maxRetries");
      expect(cfg.queue).toHaveProperty("retryDelays");
      expect(cfg.opencode).toHaveProperty("url");
      expect(cfg.opencode).toHaveProperty("model");
      expect(cfg.opencode).toHaveProperty("fallbackModels");
      expect(cfg.e2b).toHaveProperty("sandboxTimeoutMs");
      expect(cfg.stas).toHaveProperty("rateLimit.max");
      expect(cfg.phaseTimeouts).toHaveProperty("triage");
      expect(cfg.phaseTimeouts).toHaveProperty("sandboxBoot");
      expect(cfg.phaseTimeouts).toHaveProperty("openCodeAgent");
      expect(cfg.phaseTimeouts).toHaveProperty("prCreation");
    });
  });
});
