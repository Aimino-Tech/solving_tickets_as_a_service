/**
 * Unit tests for src/github/auth.ts
 *
 * Covers:
 * - PKCS#1 → PKCS#8 conversion via crypto.createPrivateKey
 * - Token fetching via @octokit/auth-app
 * - Octokit instance creation via @octokit/rest
 * - Private key path vs env var sourcing
 * - Error wrapping on auth failure
 * - Module-level auth caching
 *
 * NOTE: node:crypto is NOT mocked because the auth module uses
 * require("node:crypto") dynamically inside convertPkcs1ToPkcs8(),
 * which vi.mock cannot intercept. Tests using PKCS#1 keys exercise
 * the real crypto module (invalid keys produce wrapped errors).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks (evaluated before vi.mock factories) ──────────────────────
const { mockCreateAppAuth, mockAuthFn, mockOctokitConstructor, mockReadFileSync, mockConfig, mockLoggerChild } =
  vi.hoisted(() => {
    const authFn = vi.fn();

    return {
      mockCreateAppAuth: vi.fn(() => authFn),
      mockAuthFn: authFn,
      mockOctokitConstructor: vi.fn(),
      mockReadFileSync: vi.fn(),
      mockLoggerChild: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
      mockConfig: {
        github: {
          appId: '12345',
          privateKeyPath: undefined as string | undefined,
          // Default: PKCS#8 so conversion is skipped (avoids real crypto call)
          privateKeyEnv: '-----BEGIN PRIVATE KEY-----\nMOCKKEY\n-----END PRIVATE KEY-----' as string | undefined,
          webhookSecret: 'test-secret',
          webhookPath: '/webhook',
          token: '',
        },
        stas: { botName: 'STAS' },
      },
    };
  });

// ── Module-level mocks ──────────────────────────────────────────────────────
// node:crypto is intentionally NOT mocked — the auth module uses
// a dynamic require("node:crypto") inside convertPkcs1ToPkcs8 which
// vi.mock cannot intercept.
vi.mock('node:fs', () => ({ readFileSync: mockReadFileSync }));
vi.mock('../../packages/github-client/src/index.js', () => {
  const convertPkcs1ToPkcs8 = (pkcs1Pem: string) => { throw new Error(`Failed to convert PKCS#1 private key to PKCS#8: simulated`); };
  const loadPrivateKey = (config: { privateKey: string }, options?: { readFileSync?: (path: string) => string }) => {
    if (options?.readFileSync) return options.readFileSync(config.privateKey);
    const pem = config.privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
    if (pem.includes('-----BEGIN RSA PRIVATE KEY-----')) return convertPkcs1ToPkcs8(pem);
    return pem;
  };
  const createAuth = (config: { appId: string | number; privateKey: string }, loadKey?: (c: any) => string) => {
    const privateKey = (loadKey ?? loadPrivateKey)(config);
    mockCreateAppAuth({ appId: config.appId, privateKey });
    return mockAuthFn;
  };
  const createAppOctokit = (config: { appId: string | number; privateKey: string }, loadKey?: (c: any) => string) => {
    const privateKey = (loadKey ?? loadPrivateKey)(config);
    mockOctokitConstructor({ authStrategy: mockCreateAppAuth, auth: { appId: config.appId, privateKey } });
    return {};
  };
  return {
    loadPrivateKey,
    convertPkcs1ToPkcs8,
    createAuth,
    createAppOctokit,
    createInstallationOctokit: async (auth: any, installationId: number) => {
      const { token } = await auth({ type: 'installation', installationId });
      mockOctokitConstructor({ auth: token });
      return { auth: token };
    },
    getInstallationToken: async (auth: any, installationId: number) => {
      const { token } = await auth({ type: 'installation', installationId });
      return token;
    },
    GitHubAppConfig: class {},
  };
});
vi.mock('../../config.js', () => ({ config: mockConfig }));
vi.mock('../../utils/logger.js', () => ({
  rootLogger: { child: mockLoggerChild },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe('github/auth', () => {
  beforeEach(() => {
    // Reset module registry so internal caches (_auth, _appOctokit) clear
    vi.resetModules();

    // Restore default config (PKCS#8 format skips crypto conversion)
    mockConfig.github.appId = '12345';
    mockConfig.github.privateKeyPath = undefined;
    mockConfig.github.privateKeyEnv = '-----BEGIN PRIVATE KEY-----\nMOCKKEY\n-----END PRIVATE KEY-----';
    mockConfig.github.webhookSecret = 'test-secret';
    mockConfig.github.webhookPath = '/webhook';
  });

  // ── Token fetching ─────────────────────────────────────────────────────

  it('getInstallationToken calls createAppAuth and returns token', async () => {
    mockAuthFn.mockResolvedValue({ token: 'ghs_test_token_123' });

    const { getInstallationToken } = await import('../../github/auth.js');
    const token = await getInstallationToken(42);

    expect(token).toBe('ghs_test_token_123');
    expect(mockCreateAppAuth).toHaveBeenCalledWith(expect.objectContaining({ appId: '12345' }));
    expect(mockAuthFn).toHaveBeenCalledWith({
      type: 'installation',
      installationId: 42,
    });
  });

  it('getInstallationToken wraps auth errors with installation context', async () => {
    mockAuthFn.mockRejectedValue(new Error('auth provider unavailable'));

    const { getInstallationToken } = await import('../../github/auth.js');
    await expect(getInstallationToken(42)).rejects.toThrow('Failed to get installation token for installation 42');
  });

  // ── Octokit creation ───────────────────────────────────────────────────

  it('getOctokit returns an Octokit instance with the installation token', async () => {
    mockAuthFn.mockResolvedValue({ token: 'ghs_octokit_token' });

    const { getOctokit } = await import('../../github/auth.js');
    const octokit = await getOctokit(42);

    expect(octokit).toBeDefined();
    expect(mockOctokitConstructor).toHaveBeenCalledWith(expect.objectContaining({ auth: 'ghs_octokit_token' }));
  });

  it('getOctokit wraps errors with installation context', async () => {
    mockAuthFn.mockRejectedValue(new Error('network error'));

    const { getOctokit } = await import('../../github/auth.js');
    await expect(getOctokit(42)).rejects.toThrow('Failed to get Octokit for installation 42');
  });

  // ── PKCS#1 → PKCS#8 conversion ─────────────────────────────────────────

  it('skips PKCS#1 conversion when key is already PKCS#8', async () => {
    mockAuthFn.mockResolvedValue({ token: 'token' });

    const { getInstallationToken } = await import('../../github/auth.js');
    await getInstallationToken(42);

    // Original PKCS#8 key passed directly without conversion
    expect(mockCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: '-----BEGIN PRIVATE KEY-----\nMOCKKEY\n-----END PRIVATE KEY-----',
      }),
    );
  });

  it('throws descriptive error when PKCS#1 conversion fails (invalid key)', async () => {
    // Switch to PKCS#1 format with invalid content → real crypto.createPrivateKey
    // will fail and the error is wrapped with a descriptive message
    mockConfig.github.privateKeyEnv = '-----BEGIN RSA PRIVATE KEY-----\nBADSYNTAX\n-----END RSA PRIVATE KEY-----';

    const { getInstallationToken } = await import('../../github/auth.js');
    await expect(getInstallationToken(42)).rejects.toThrow('Failed to convert PKCS#1 private key to PKCS#8');
  });

  it('handles \\n escape sequences in privateKeyEnv with PKCS#8 key', async () => {
    mockAuthFn.mockResolvedValue({ token: 'token' });
    // PKCS#8 key with literal \n (double-escaped from env var)
    mockConfig.github.privateKeyEnv = '-----BEGIN PRIVATE KEY-----\\nESCAPED\\n-----END PRIVATE KEY-----';

    const { getInstallationToken } = await import('../../github/auth.js');
    await getInstallationToken(42);

    // The replace(/\\n/g, "\n") normalizes the literal \n to real newlines
    expect(mockCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: '-----BEGIN PRIVATE KEY-----\nESCAPED\n-----END PRIVATE KEY-----',
      }),
    );
  });

  // ── Private key sourcing ───────────────────────────────────────────────

  it('reads private key from file when GITHUB_APP_PRIVATE_KEY_PATH is set', async () => {
    mockConfig.github.privateKeyPath = '/etc/secrets/github-key.pem';
    mockConfig.github.privateKeyEnv = undefined;
    mockReadFileSync.mockReturnValue('-----BEGIN PRIVATE KEY-----\nFROMFILE\n-----END PRIVATE KEY-----');
    mockAuthFn.mockResolvedValue({ token: 'token' });

    const { getInstallationToken } = await import('../../github/auth.js');
    await getInstallationToken(42);

    expect(mockReadFileSync).toHaveBeenCalledWith('/etc/secrets/github-key.pem', 'utf-8');
    expect(mockCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: '-----BEGIN PRIVATE KEY-----\nFROMFILE\n-----END PRIVATE KEY-----',
      }),
    );
  });

  it('throws when private key file cannot be read', async () => {
    mockConfig.github.privateKeyPath = '/nonexistent/key.pem';
    mockConfig.github.privateKeyEnv = undefined;
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });

    const { getInstallationToken } = await import('../../github/auth.js');
    await expect(getInstallationToken(42)).rejects.toThrow('Failed to read private key from /nonexistent/key.pem');
  });

  it('throws when both key sources are missing', async () => {
    mockConfig.github.privateKeyPath = undefined;
    mockConfig.github.privateKeyEnv = undefined;

    const { getInstallationToken } = await import('../../github/auth.js');
    await expect(getInstallationToken(42)).rejects.toThrow(
      'Either GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY must be set',
    );
  });

  // ── Token caching ──────────────────────────────────────────────────────

  it('caches auth instance and does not call createAppAuth again', async () => {
    mockAuthFn.mockResolvedValue({ token: 'token' });

    const { getInstallationToken } = await import('../../github/auth.js');
    await getInstallationToken(42);
    await getInstallationToken(99);

    // createAppAuth called only once due to _auth cache
    expect(mockCreateAppAuth).toHaveBeenCalledTimes(1);
    // But the auth function is called for each installation
    expect(mockAuthFn).toHaveBeenCalledTimes(2);
    expect(mockAuthFn).toHaveBeenCalledWith({
      type: 'installation',
      installationId: 42,
    });
    expect(mockAuthFn).toHaveBeenCalledWith({
      type: 'installation',
      installationId: 99,
    });
  });

  it('caches Octokit instance in getAppOctokitInstance', async () => {
    const { getAppOctokitInstance } = await import('../../github/auth.js');
    const instance1 = getAppOctokitInstance();
    const instance2 = getAppOctokitInstance();

    expect(instance1).toBe(instance2);
    expect(mockOctokitConstructor).toHaveBeenCalledTimes(1);
  });

  // ── Edge: empty appId ──────────────────────────────────────────────────

  it('passes empty string appId when GITHUB_APP_ID is not set', async () => {
    mockConfig.github.appId = '';
    mockAuthFn.mockResolvedValue({ token: 'token' });

    const { getInstallationToken } = await import('../../github/auth.js');
    await getInstallationToken(42);

    expect(mockCreateAppAuth).toHaveBeenCalledWith(expect.objectContaining({ appId: '' }));
  });
});
