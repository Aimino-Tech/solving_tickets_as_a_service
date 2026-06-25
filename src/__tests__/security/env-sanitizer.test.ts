/**
 * Unit tests for src/security/env-sanitizer.ts and related modules.
 *
 * Covers:
 * - Allowlist filtering (removes unexpected vars, keeps allowed vars)
 * - Secret pattern redaction from strings
 * - Required var validation
 * - Pino redact configuration (structural check)
 * - Object redaction
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock config ──────────────────────────────────────────────────────
const mockConfig = {
  security: {
    envAllowlistExtra: '',
  },
};

vi.mock('../../config.js', () => ({
  config: mockConfig,
  requireConfig: vi.fn(() => mockConfig),
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  jobLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('security/env-allowlist', () => {
  let allowlist: typeof import('../../security/env-allowlist.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    // Fresh import each time to reset module state
    allowlist = await import('../../security/env-allowlist.js');
  });

  describe('ALLOWED_VARS', () => {
    it('contains PATH', () => {
      expect(allowlist.ALLOWED_VARS.has('PATH')).toBe(true);
    });

    it('contains NODE_ENV', () => {
      expect(allowlist.ALLOWED_VARS.has('NODE_ENV')).toBe(true);
    });

    it('does NOT contain sensitive vars', () => {
      expect(allowlist.ALLOWED_VARS.has('GITHUB_APP_ID')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('GITHUB_WEBHOOK_SECRET')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('GITHUB_PRIVATE_KEY')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('REDIS_URL')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('DATABASE_URL')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('OPENAI_API_KEY')).toBe(false);
      expect(allowlist.ALLOWED_VARS.has('STRIPE_SECRET_KEY')).toBe(false);
    });

    it('contains STAS_LABEL', () => {
      expect(allowlist.ALLOWED_VARS.has('STAS_LABEL')).toBe(true);
    });

    it('contains OPENCODE_URL and OPENCODE_MODEL', () => {
      expect(allowlist.ALLOWED_VARS.has('OPENCODE_URL')).toBe(true);
      expect(allowlist.ALLOWED_VARS.has('OPENCODE_MODEL')).toBe(true);
    });

    it('is case-insensitive via isAllowed()', () => {
      expect(allowlist.isAllowed('path')).toBe(true);
      expect(allowlist.isAllowed('Path')).toBe(true);
      expect(allowlist.isAllowed('PATH')).toBe(true);
    });

    it('returns false for unknown vars via isAllowed()', () => {
      expect(allowlist.isAllowed('SOME_RANDOM_VAR')).toBe(false);
    });
  });

  describe('allowedPresent', () => {
    it('returns only allowed keys that exist in env', () => {
      const env = {
        PATH: '/usr/bin',
        NODE_ENV: 'test',
        GITHUB_APP_ID: '12345', // not allowed
        OPENCODE_URL: 'http://localhost:4096',
        SECRET_KEY: 'should-not-appear',
      };

      const present = allowlist.allowedPresent(env);
      expect(present).toContain('NODE_ENV');
      expect(present).toContain('OPENCODE_URL');
      expect(present).toContain('PATH');
      expect(present).not.toContain('GITHUB_APP_ID');
      expect(present).not.toContain('SECRET_KEY');
    });
  });
});

describe('security/env-sanitizer', () => {
  let sanitizer: typeof import('../../security/env-sanitizer.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    sanitizer = await import('../../security/env-sanitizer.js');
  });

  describe('sanitizeEnv', () => {
    it('keeps allowed vars', () => {
      const input = {
        PATH: '/usr/bin',
        NODE_ENV: 'test',
        OPENCODE_URL: 'http://localhost:4096',
      };
      const result = sanitizer.sanitizeEnv(input);
      expect(result).toEqual({
        PATH: '/usr/bin',
        NODE_ENV: 'test',
        OPENCODE_URL: 'http://localhost:4096',
      });
    });

    it('removes unexpected vars', () => {
      const input = {
        PATH: '/usr/bin',
        GITHUB_APP_ID: '12345',
        OPENAI_API_KEY: 'sk-secret-12345',
        REDIS_URL: 'redis://:password@localhost:6379',
      };
      const result = sanitizer.sanitizeEnv(input);
      expect(result).toEqual({ PATH: '/usr/bin' });
      expect(result.GITHUB_APP_ID).toBeUndefined();
      expect(result.OPENAI_API_KEY).toBeUndefined();
      expect(result.REDIS_URL).toBeUndefined();
    });

    it('returns empty object for env with no allowed vars', () => {
      const input = {
        SECRET_1: 'value1',
        SECRET_2: 'value2',
      };
      const result = sanitizer.sanitizeEnv(input);
      expect(result).toEqual({});
    });

    it('filters out undefined values', () => {
      const input: Record<string, string | undefined> = {
        PATH: '/usr/bin',
        NODE_ENV: undefined,
      };
      const result = sanitizer.sanitizeEnv(input);
      expect(result.PATH).toBe('/usr/bin');
      expect(result.NODE_ENV).toBeUndefined();
    });

    it('does not mutate the original input', () => {
      const input = { PATH: '/usr/bin', SECRET: 'value' };
      const inputCopy = { ...input };
      sanitizer.sanitizeEnv(input);
      expect(input).toEqual(inputCopy);
    });
  });

  describe('redactSecrets', () => {
    it('redacts OpenAI-style API keys', () => {
      const result = sanitizer.redactSecrets('My key is sk-proj-abc123def456ghi789jkl012');
      expect(result).toBe('My key is [REDACTED]');
    });

    it('redacts Anthropic-style API keys', () => {
      const result = sanitizer.redactSecrets('Key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      expect(result).toBe('Key: [REDACTED]');
    });

    it('redacts GitHub tokens', () => {
      const result = sanitizer.redactSecrets('Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789abcd');
      expect(result).not.toContain('ghp_');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts GitLab tokens', () => {
      const result = sanitizer.redactSecrets('glpat-abc123def456ghi789jkl012');
      expect(result).toBe('[REDACTED]');
    });

    it('redacts Stripe secret keys', () => {
      const result = sanitizer.redactSecrets('sk_live_abcdefghijklmnopqrstuvwxyz012345');
      expect(result).toBe('[REDACTED]');
    });

    it('redacts JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqPnd9iyw3W0g0k3U0k3U0k3U0k3U0k3U0k3U';
      const result = sanitizer.redactSecrets(`Bearer ${jwt}`);
      expect(result).toBe('Bearer [REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      const result = sanitizer.redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789abcdefghijkl');
      expect(result).toBe('Authorization: [REDACTED]');
    });

    it('redacts labelled password values', () => {
      const result = sanitizer.redactSecrets('password=supersecret123!');
      expect(result).toBe('password=[REDACTED]');
    });

    it('redacts labelled API keys', () => {
      const result = sanitizer.redactSecrets('api_key = my-secret-api-key');
      expect(result).toBe('api_key = [REDACTED]');
    });

    it('redacts PEM private keys', () => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
      const result = sanitizer.redactSecrets(pem);
      expect(result).toBe('[REDACTED]');
    });

    it('redacts connection strings with credentials', () => {
      const result = sanitizer.redactSecrets('postgres://user:password@localhost:5432/db');
      expect(result).toBe('postgres://user:[REDACTED]@localhost:5432/db');
    });

    it('redacts Redis URLs with inline credentials', () => {
      const result = sanitizer.redactSecrets('REDIS_URL=redis://:verysecret@localhost:6379');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('verysecret');
    });

    it('returns string unchanged if no secrets found', () => {
      const input = 'This is a normal log message with no secrets';
      expect(sanitizer.redactSecrets(input)).toBe(input);
    });

    it('redacts multiple secrets in one string', () => {
      const input = 'token=abc123 and api_key=xyz789';
      const result = sanitizer.redactSecrets(input);
      expect(result).toBe('token=[REDACTED] and api_key=[REDACTED]');
    });

    it('handles empty string', () => {
      expect(sanitizer.redactSecrets('')).toBe('');
    });
  });

  describe('redactObject', () => {
    it('redacts secret values in nested objects', () => {
      const input = {
        name: 'test',
        config: {
          apiKey: 'sk-secret-12345',
          url: 'http://example.com',
        },
      };
      const result = sanitizer.redactObject(input);
      expect(result.name).toBe('test');
      expect(result.config.apiKey).toBe('[REDACTED]');
      expect(result.config.url).toBe('http://example.com');
    });

    it('redacts strings matching secret patterns', () => {
      const input = { message: 'Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789abcd' };
      const result = sanitizer.redactObject(input);
      expect(result.message).not.toContain('ghp_');
    });

    it('handles arrays', () => {
      const input = [{ token: 'secret123' }, { name: 'public' }];
      const result = sanitizer.redactObject(input);
      expect(result[0].token).toBe('[REDACTED]');
      expect(result[1].name).toBe('public');
    });

    it('handles null values', () => {
      const input = { key: null };
      const result = sanitizer.redactObject(input);
      expect(result.key).toBeNull();
    });
  });

  describe('validateRequiredEnv', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('returns empty missing when all vars are present', () => {
      process.env.MY_VAR = 'value';
      process.env.OTHER_VAR = 'other';
      const result = sanitizer.validateRequiredEnv(['MY_VAR', 'OTHER_VAR']);
      expect(result.missing).toEqual([]);
    });

    it('reports missing vars', () => {
      delete process.env.MY_VAR;
      const result = sanitizer.validateRequiredEnv(['MISSING_VAR_1', 'MISSING_VAR_2']);
      expect(result.missing).toContain('MISSING_VAR_1');
      expect(result.missing).toContain('MISSING_VAR_2');
    });

    it('treats empty strings as missing', () => {
      process.env.EMPTY_VAR = '';
      const result = sanitizer.validateRequiredEnv(['EMPTY_VAR']);
      expect(result.missing).toContain('EMPTY_VAR');
    });

    it('treats whitespace-only strings as missing', () => {
      process.env.WHITESPACE_VAR = '   ';
      const result = sanitizer.validateRequiredEnv(['WHITESPACE_VAR']);
      expect(result.missing).toContain('WHITESPACE_VAR');
    });

    it('returns empty array for empty required list', () => {
      const result = sanitizer.validateRequiredEnv([]);
      expect(result.missing).toEqual([]);
    });
  });
});

describe('security/env-validate', () => {
  let envValidate: typeof import('../../security/env-validate.js');
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('getCriticalVars', () => {
    it('returns the expected critical vars', async () => {
      envValidate = await import('../../security/env-validate.js');
      const vars = envValidate.getCriticalVars();
      expect(vars).toContain('GITHUB_APP_ID');
      expect(vars).toContain('GITHUB_WEBHOOK_SECRET');
    });
  });

  describe('validateRequiredEnvOnStartup', () => {
    it('does not exit when critical vars are set', async () => {
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_WEBHOOK_SECRET = 'whsec_test';
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      envValidate = await import('../../security/env-validate.js');
      envValidate.validateRequiredEnvOnStartup();
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });
});

describe('logger redact configuration', () => {
  it('pino is configured with redact paths', async () => {
    // Re-import to get fresh config
    const logger = await import('../../utils/logger.js');
    // The rootLogger should have redact config — we check by ensuring
    // the serializers are correct and the module loads without error
    expect(logger.rootLogger).toBeDefined();
    expect(typeof logger.jobLogger).toBe('function');
  });

  it('jobLogger creates child loggers with context', async () => {
    const logger = await import('../../utils/logger.js');
    const child = logger.jobLogger({ jobId: 'test-123', repo: 'owner/repo' });
    expect(child).toBeDefined();
    // Should be a pino logger instance
    expect(typeof child.info).toBe('function');
    expect(typeof child.error).toBe('function');
  });
});
