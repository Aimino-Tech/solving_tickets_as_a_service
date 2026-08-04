/**
 * Unit tests for E2B sandbox executor (src/sandbox/executor.ts).
 *
 * Strategy:
 *   Module-level vi.mock replaces the "e2b" package so Sandbox.create() returns
 *   a controlled fake.  The config and logger are also mocked so tests never
 *   touch real env vars or produce noisy output.
 *
 *   Most tests bypass boot() by setting the private sandbox field directly
 *   via a helper (createExecutor).  boot() itself is tested separately with
 *   a command-routing mock that simulates clone, ls, cat, and install.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult, RuntimeInfo } from '../../sandbox/executor.js';

// ---------------------------------------------------------------------------
// Hoisted helpers — available inside vi.mock factories (hoisted above imports)
// ---------------------------------------------------------------------------

const mockSandboxInstance = vi.hoisted(() => ({
  sandboxId: 'mock-sandbox-id',
  commands: {
    run: vi.fn() as ReturnType<typeof vi.fn>,
  },
  files: {
    read: vi.fn() as ReturnType<typeof vi.fn>,
    write: vi.fn() as ReturnType<typeof vi.fn>,
    remove: vi.fn() as ReturnType<typeof vi.fn>,
    makeDir: vi.fn() as ReturnType<typeof vi.fn>,
  },
  kill: vi.fn() as ReturnType<typeof vi.fn>,
  close: vi.fn() as ReturnType<typeof vi.fn>,
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn() as ReturnType<typeof vi.fn>,
  warn: vi.fn() as ReturnType<typeof vi.fn>,
  error: vi.fn() as ReturnType<typeof vi.fn>,
  debug: vi.fn() as ReturnType<typeof vi.fn>,
  fatal: vi.fn() as ReturnType<typeof vi.fn>,
  trace: vi.fn() as ReturnType<typeof vi.fn>,
  silent: vi.fn() as ReturnType<typeof vi.fn>,
  level: 'silent',
  child: vi.fn() as ReturnType<typeof vi.fn>,
}));

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('e2b', () => ({
  Sandbox: { create: vi.fn().mockResolvedValue(mockSandboxInstance) },
}));

vi.mock('../../config.js', () => ({
  config: {
    e2b: {
      apiKey: 'test-api-key',
      templateId: 'test-template',
      sandboxTimeoutMs: 300_000,
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  rootLogger: {
    child: vi.fn().mockReturnValue(mockLogger),
  },
}));

// ---------------------------------------------------------------------------
// Import subject under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { SandboxExecutor } from '../../sandbox/executor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default successful command result used as fallback. */
const DEFAULT_OK: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

/**
 * Create a SandboxExecutor with the sandbox field pre-initialised so callers
 * can test methods without going through boot().
 */
function createExecutor(): import('../../sandbox/types.js').SandboxExecutor {
  const getToken = vi.fn<(installationId: number) => Promise<string>>().mockResolvedValue('mock-installation-token');
  const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken);
  // Bypass boot() — set private fields directly
  (executor as any).sandbox = mockSandboxInstance;
  (executor as any).repoDir = '/home/user/repo';
  (executor as any).runtimeInfo = {
    language: 'node',
    version: '20',
    testCommand: 'npm test 2>&1',
    installCommand: 'npm install',
    formatCommand: 'npx prettier --write . 2>&1 || true',
    lintCommand: 'npx tsc --noEmit 2>&1',
  };
  (executor as any).installationToken = 'mock-installation-token';
  return executor;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SandboxExecutor', () => {
  beforeEach(async () => {
    // Reset all mock calls and restore default behaviours so each test starts clean.
    vi.clearAllMocks();

    // RestoreMocks resets Sandbox.create to bare vi.fn() — re-arm it.
    const { Sandbox: MockSandbox } = await import('e2b');
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSandboxInstance);

    // Default: return success for any command.run() call
    mockSandboxInstance.commands.run.mockResolvedValue(DEFAULT_OK);

    // Default file ops
    mockSandboxInstance.files.read.mockResolvedValue('file content');
    mockSandboxInstance.files.write.mockResolvedValue(undefined);
    mockSandboxInstance.files.remove.mockResolvedValue(undefined);
    mockSandboxInstance.files.makeDir.mockResolvedValue(undefined);
    mockSandboxInstance.kill.mockResolvedValue(undefined);

    // Default child logger returns itself
    mockLogger.child.mockReturnValue(mockLogger);
  });

  // ── Constructor ───────────────────────────────────────────────────────

  describe('constructor', () => {
    it('stores repoOwner', () => {
      const getToken = vi.fn();
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'my-owner', 'my-repo', 123, getToken);
      expect((executor as any).repoOwner).toBe('my-owner');
    });

    it('stores repoName', () => {
      const getToken = vi.fn();
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'my-repo', 123, getToken);
      expect((executor as any).repoName).toBe('my-repo');
    });

    it('stores github token getter (getToken)', () => {
      const getToken = vi.fn().mockResolvedValue('my-token');
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken);
      expect((executor as any).getToken).toBe(getToken);
    });
  });

  // ── boot() ────────────────────────────────────────────────────────────

  describe('boot()', () => {
    function setupBootMock(runtime: 'node' | 'python' | 'go' | 'rust' = 'node', pkgJson: Record<string, unknown> = {}) {
      const lsOutputs: Record<string, string> = {
        node: 'package.json\ntsconfig.json\nyarn.lock\n',
        python: 'requirements.txt\nsetup.py\n',
        go: 'go.mod\nmain.go\n',
        rust: 'Cargo.toml\nsrc\n',
      };

      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        if (command.startsWith('git clone')) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        if (command.startsWith('ls -la')) {
          return { stdout: lsOutputs[runtime] ?? lsOutputs.node, stderr: '', exitCode: 0 };
        }
        if (command.includes('cat') && command.includes('package.json')) {
          return { stdout: JSON.stringify(pkgJson), stderr: '', exitCode: 0 };
        }
        if (command.includes('--version')) {
          return { stdout: 'v1.0.0', stderr: '', exitCode: 0 };
        }
        // Install command (varies by runtime)
        if (
          command.includes('install') ||
          command.includes('go mod download') ||
          command.includes('go mod tidy') ||
          command.includes('cargo fetch')
        ) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });
    }

    it('calls Sandbox.create with correct parameters', async () => {
      setupBootMock();
      const { Sandbox: MockSandbox } = await import('e2b');

      const getToken = vi.fn().mockResolvedValue('token');
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken);

      (executor as any).sandbox = null; // ensure boot() creates fresh
      await executor.boot();

      expect(MockSandbox.create).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        template: 'test-template',
        timeoutMs: 300_000,
      });
    });

    it('gets installation token via getToken callback', async () => {
      setupBootMock();
      const getToken = vi.fn().mockResolvedValue('fresh-token');

      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 42, getToken);
      (executor as any).sandbox = null;
      await executor.boot();

      expect(getToken).toHaveBeenCalledWith(42);
      expect((executor as any).installationToken).toBe('fresh-token');
    });

    it('clones the repository with auth token in URL', async () => {
      setupBootMock();
      const getToken = vi.fn().mockResolvedValue('secret123');
      const executor = new SandboxExecutor(
        'https://github.com/owner/test-repo.git',
        'owner',
        'test-repo',
        123,
        getToken,
      );
      (executor as any).sandbox = null;
      await executor.boot();

      const cloneCall = mockSandboxInstance.commands.run.mock.calls.find(([cmd]: string[]) =>
        cmd.startsWith('git clone'),
      );
      expect(cloneCall).toBeDefined();
      const cloneCmd: string = cloneCall![0];
      expect(cloneCmd).toContain('x-access-token:secret123@');
      expect(cloneCmd).toContain('github.com/owner/test-repo.git');
      expect(cloneCmd).toContain('--depth 1');
      expect(cloneCmd).toContain('/home/user/test-repo');
    });

    it('detects runtime after cloning', async () => {
      setupBootMock('node');
      const executor = new SandboxExecutor(
        'https://github.com/owner/repo.git',
        'owner',
        'repo',
        123,
        vi.fn().mockResolvedValue('token'),
      );
      (executor as any).sandbox = null;
      await executor.boot();

      expect((executor as any).runtimeInfo).not.toBeNull();
      expect((executor as any).runtimeInfo.language).toBe('node');
    });

    it('throws with descriptive error when Sandbox.create fails', async () => {
      const { Sandbox: MockSandbox } = await import('e2b');
      (MockSandbox.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API quota exceeded'));

      const executor = new SandboxExecutor(
        'https://github.com/owner/repo.git',
        'owner',
        'repo',
        123,
        vi.fn().mockResolvedValue('token'),
      );
      (executor as any).sandbox = null;

      await expect(executor.boot()).rejects.toThrow('Failed to create E2B sandbox');
    });

    it('throws with descriptive error when getToken fails', async () => {
      setupBootMock();
      const getToken = vi.fn().mockRejectedValue(new Error('Auth failed'));
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, getToken);
      (executor as any).sandbox = null;

      await expect(executor.boot()).rejects.toThrow('Failed to get installation token');
    });

    it('throws when git clone fails', async () => {
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        if (command.startsWith('git clone')) {
          return { stdout: '', stderr: 'Repository not found', exitCode: 128 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      const executor = new SandboxExecutor(
        'https://github.com/owner/repo.git',
        'owner',
        'repo',
        123,
        vi.fn().mockResolvedValue('token'),
      );
      (executor as any).sandbox = null;

      await expect(executor.boot()).rejects.toThrow('Failed to clone repo: Repository not found');
    });
  });

  // ── Runtime detection ─────────────────────────────────────────────────

  describe('detectRuntime()', () => {
    async function detectFor(lsOutput: string, extraMocks?: Record<string, ExecResult>): Promise<RuntimeInfo> {
      const executor = createExecutor();
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        // Check extra mocks first (for version commands, cat, etc.)
        if (extraMocks) {
          for (const [prefix, result] of Object.entries(extraMocks)) {
            if (command.startsWith(prefix)) return result;
          }
        }
        if (command.startsWith('ls -la')) {
          return { stdout: lsOutput, stderr: '', exitCode: 0 };
        }
        return DEFAULT_OK;
      });
      return executor.detectRuntime();
    }

    it('detects node from package.json', async () => {
      const info = await detectFor('package.json\ntsconfig.json\n', {
        cat: {
          stdout: JSON.stringify({ scripts: { test: 'vitest run' }, engines: { node: '>=18' } }),
          stderr: '',
          exitCode: 0,
        },
      });
      expect(info.language).toBe('node');
      expect(info.version).toBe('>=18');
      expect(info.testCommand).toContain('npm test');
    });

    it('detects node with turbo monorepo', async () => {
      const info = await detectFor('package.json\ntsconfig.json\n', {
        cat: { stdout: JSON.stringify({ scripts: { test: 'vitest run' }, turbo: {} }), stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('node');
      expect(info.testCommand).toContain('turbo');
    });

    it('detects node with nx monorepo', async () => {
      const info = await detectFor('package.json\ntsconfig.json\n', {
        cat: { stdout: JSON.stringify({ scripts: { test: 'vitest run' }, nx: {} }), stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('node');
      expect(info.testCommand).toContain('nx');
    });

    it('detects node with yarn.lock', async () => {
      const info = await detectFor('package.json\nyarn.lock\n', {
        cat: { stdout: JSON.stringify({}), stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('node');
      expect(info.installCommand).toBe('yarn install');
    });

    it('detects node with pnpm-lock.yaml', async () => {
      const info = await detectFor('package.json\npnpm-lock.yaml\n', {
        cat: { stdout: JSON.stringify({}), stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('node');
      expect(info.installCommand).toBe('pnpm install');
    });

    it('detects node with biome.json for formatting', async () => {
      const info = await detectFor('package.json\nbiome.json\n', {
        cat: { stdout: JSON.stringify({}), stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('node');
      expect(info.formatCommand).toContain('biome');
    });

    it('detects python from requirements.txt', async () => {
      const info = await detectFor('requirements.txt\nsrc\n', {
        'python3 --version': { stdout: 'Python 3.12', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('python');
      expect(info.installCommand).toContain('pip install -r');
    });

    it('detects python from pyproject.toml', async () => {
      const info = await detectFor('pyproject.toml\nsrc\n', {
        'python3 --version': { stdout: 'Python 3.12', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('python');
    });

    it('detects python from Pipfile', async () => {
      const info = await detectFor('Pipfile\nsrc\n', {
        'python3 --version': { stdout: 'Python 3.12', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('python');
      expect(info.installCommand).toContain('pipenv');
    });

    it('detects go from go.mod', async () => {
      const info = await detectFor('go.mod\nmain.go\n', {
        'go version': { stdout: 'go version go1.22', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('go');
      expect(info.testCommand).toBe('go test ./... 2>&1');
      expect(info.formatCommand).toBe('go fmt ./... 2>&1');
    });

    it('detects rust from Cargo.toml', async () => {
      const info = await detectFor('Cargo.toml\nsrc\n', {
        'rustc --version': { stdout: 'rustc 1.78.0', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('rust');
      expect(info.testCommand).toBe('cargo test 2>&1');
    });

    it('detects ruby from Gemfile', async () => {
      const info = await detectFor('Gemfile\n', {
        'ruby --version': { stdout: 'ruby 3.3.0', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('ruby');
      expect(info.testCommand).toContain('rspec');
    });

    it('detects java from pom.xml', async () => {
      const info = await detectFor('pom.xml\n', {
        'java -version': { stdout: 'openjdk 21', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('java');
      expect(info.testCommand).toBe('mvn test 2>&1');
    });

    it('detects java from build.gradle', async () => {
      const info = await detectFor('build.gradle\n', {
        'java -version': { stdout: 'openjdk 21', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('java');
      expect(info.testCommand).toBe('./gradlew test 2>&1');
    });

    it('detects php from composer.json', async () => {
      const info = await detectFor('composer.json\n', {
        'php --version': { stdout: 'PHP 8.3', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('php');
      expect(info.installCommand).toContain('composer install');
    });

    it('detects swift from Package.swift', async () => {
      const info = await detectFor('Package.swift\n', {
        'swift --version': { stdout: 'swift 5.10', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('swift');
      expect(info.testCommand).toBe('swift test 2>&1');
    });

    it('detects dart/flutter from pubspec.yaml', async () => {
      const info = await detectFor('pubspec.yaml\n', {
        'dart --version': { stdout: 'Dart 3.4', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('dart');
      expect(info.installCommand).toContain('flutter pub get');
    });

    it('detects elixir from mix.exs', async () => {
      const info = await detectFor('mix.exs\n', {
        'elixir --version': { stdout: 'Elixir 1.17', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('elixir');
      expect(info.testCommand).toBe('mix test 2>&1');
    });

    it('detects cpp from CMakeLists.txt', async () => {
      const info = await detectFor('CMakeLists.txt\n', {
        'g++ --version || clang++ --version': { stdout: 'g++ 14', stderr: '', exitCode: 0 },
      });
      expect(info.language).toBe('cpp');
      expect(info.testCommand).toContain('ctest');
    });

    it('defaults to unknown when no markers match', async () => {
      const info = await detectFor('README.md\nLICENSE\n');
      expect(info.language).toBe('unknown');
      expect(info.testCommand).toBe('');
    });
  });

  // ── exec() ────────────────────────────────────────────────────────────

  describe('exec()', () => {
    it('runs a command in the sandbox and returns stdout', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      });
      const executor = createExecutor();
      const result = await executor.exec('echo hello');
      expect(result.stdout).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('returns stderr on command failure', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: '',
        stderr: 'command not found',
        exitCode: 127,
      });
      const executor = createExecutor();
      const result = await executor.exec('nonexistent');
      expect(result.stderr).toBe('command not found');
      expect(result.exitCode).toBe(127);
    });

    it('passes timeout and cwd to E2B commands.run', async () => {
      const executor = createExecutor();
      await executor.exec('npm test', 120_000);
      expect(mockSandboxInstance.commands.run).toHaveBeenCalledWith(
        'npm test',
        expect.objectContaining({
          cwd: '/home/user/repo',
          timeoutMs: 120_000,
        }),
      );
    });

    it('throws if sandbox is not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.exec('npm test')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── execForTools() ────────────────────────────────────────────────────

  describe('execForTools()', () => {
    it('returns ExecResult (stdout) on success', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: 'success output',
        stderr: '',
        exitCode: 0,
      });
      const executor = createExecutor();
      const result = await executor.execForTools('npm test');
      expect(result.stdout).toBe('success output');
      expect(result.exitCode).toBe(0);
    });

    it('throws if sandbox not booted (error on failure)', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.execForTools('npm test')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── writeFile() ───────────────────────────────────────────────────────

  describe('writeFile()', () => {
    it('writes content to the sandbox', async () => {
      const executor = createExecutor();
      await executor.writeFile('src/test.ts', 'const x = 1;');

      expect(mockSandboxInstance.files.write).toHaveBeenCalledWith('/home/user/repo/src/test.ts', 'const x = 1;');
    });

    it('creates parent directory before writing', async () => {
      const executor = createExecutor();
      await executor.writeFile('src/deep/file.ts', 'content');

      expect(mockSandboxInstance.files.makeDir).toHaveBeenCalledWith('/home/user/repo/src/deep');
    });

    it('uses absolute paths as-is', async () => {
      const executor = createExecutor();
      await executor.writeFile('/etc/config.json', '{"key": "val"}');

      expect(mockSandboxInstance.files.write).toHaveBeenCalledWith('/etc/config.json', '{"key": "val"}');
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.writeFile('f.ts', 'c')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── readFile() ────────────────────────────────────────────────────────

  describe('readFile()', () => {
    it('reads file content from the sandbox', async () => {
      mockSandboxInstance.files.read.mockResolvedValue('file contents');
      const executor = createExecutor();
      const content = await executor.readFile('src/index.ts');
      expect(content).toBe('file contents');
    });

    it('prepends repoDir for relative paths', async () => {
      const executor = createExecutor();
      await executor.readFile('package.json');

      expect(mockSandboxInstance.files.read).toHaveBeenCalledWith('/home/user/repo/package.json');
    });

    it('uses absolute paths as-is', async () => {
      const executor = createExecutor();
      await executor.readFile('/tmp/output.log');

      expect(mockSandboxInstance.files.read).toHaveBeenCalledWith('/tmp/output.log');
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.readFile('f.ts')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── removeFile() ──────────────────────────────────────────────────────

  describe('removeFile()', () => {
    it('removes a file from the sandbox', async () => {
      const executor = createExecutor();
      await executor.removeFile('src/old.ts');

      expect(mockSandboxInstance.files.remove).toHaveBeenCalledWith('/home/user/repo/src/old.ts');
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.removeFile('f.ts')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── Path traversal protection ────────────────────────────────────────

  describe('path traversal protection (validatePath)', () => {
    it.each([
      '../../etc/passwd',
      '../other-repo/secret',
      'a/../../../b',
    ])('throws for traversal path: %s', async (badPath) => {
      const executor = createExecutor();
      await expect(executor.readFile(badPath)).rejects.toThrow('Path traversal detected');
      await expect(executor.writeFile(badPath, 'x')).rejects.toThrow('Path traversal detected');
      await expect(executor.removeFile(badPath)).rejects.toThrow('Path traversal detected');
    });

    it('allows absolute paths under repo', async () => {
      const executor = createExecutor();
      mockSandboxInstance.files.read.mockResolvedValue('ok');
      const result = await executor.readFile('/home/user/repo/valid/file.ts');
      expect(result).toBe('ok');
    });

    it('allows relative paths without traversal', async () => {
      const executor = createExecutor();
      mockSandboxInstance.files.read.mockResolvedValue('ok');
      const result = await executor.readFile('valid/file.ts');
      expect(result).toBe('ok');
    });

    it("allows paths with '..' inside a filename (e.g. babel.config.js)", async () => {
      const executor = createExecutor();
      mockSandboxInstance.files.read.mockResolvedValue('ok');
      // "babel.config" contains no path traversal since there's no `/` separator around `..`
      const result = await executor.readFile('babel.config.js');
      expect(result).toBe('ok');
    });
  });

  // ── pushBranch() ──────────────────────────────────────────────────────

  describe('pushBranch()', () => {
    it('configures git, commits, and pushes to the correct branch', async () => {
      const executor = createExecutor();
      // Provide real implementations for each git command
      const runLog: string[] = [];
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        runLog.push(command);
        // Git commands use -C prefix: e.g. git -C "/home/user/repo" status --porcelain
        if (command.includes('status --porcelain')) {
          return { stdout: 'M src/index.ts\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await executor.pushBranch('syntaro/fix-42');

      // Verify the push sequence
      expect(runLog.some((c) => c.includes('config user.email'))).toBe(true);
      expect(runLog.some((c) => c.includes('config user.name'))).toBe(true);
      expect(runLog.some((c) => c.includes('add -A'))).toBe(true);
      expect(runLog.some((c) => c.includes('commit -m'))).toBe(true);
      expect(runLog.some((c) => c.includes('remote set-url origin'))).toBe(true);
      expect(runLog.some((c) => c.includes('checkout -b "syntaro/fix-42"'))).toBe(true);
      expect(runLog.some((c) => c.includes('push origin "syntaro/fix-42"'))).toBe(true);
    });

    it('embeds the installation token in the remote URL', async () => {
      const executor = createExecutor();
      (executor as any).installationToken = 'push-token-abc';

      let remoteSetUrlCmd = '';
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        if (command.includes('remote set-url origin')) {
          remoteSetUrlCmd = command;
        }
        if (command.includes('status --porcelain')) {
          return { stdout: 'M README.md\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await executor.pushBranch('syntaro/fix');

      expect(remoteSetUrlCmd).toContain('x-access-token:push-token-abc@');
    });

    it('returns early when there are no changes to commit', async () => {
      const executor = createExecutor();
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        if (command.includes('status --porcelain')) {
          return { stdout: '', stderr: '', exitCode: 0 }; // empty = no changes
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await executor.pushBranch('syntaro/fix-42');

      // Should not attempt commit or push
      const calls = mockSandboxInstance.commands.run.mock.calls.map((c: any[]) => c[0]);
      expect(calls.filter((c: string) => c.includes('commit'))).toHaveLength(0);
      expect(calls.filter((c: string) => c.includes('push'))).toHaveLength(0);
    });

    it('throws on push failure with descriptive message', async () => {
      const executor = createExecutor();
      mockSandboxInstance.commands.run.mockImplementation((command: string) => {
        if (command.includes('status --porcelain')) {
          return { stdout: 'M README.md\n', stderr: '', exitCode: 0 };
        }
        if (command.includes('push origin')) {
          return { stdout: '', stderr: 'Permission denied', exitCode: 128 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await expect(executor.pushBranch('syntaro/fix-42')).rejects.toThrow("Failed to push branch 'syntaro/fix-42'");
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.pushBranch('syntaro/fix')).rejects.toThrow('Sandbox not booted');
    });
  });

  // ── runTests() ────────────────────────────────────────────────────────

  describe('runTests()', () => {
    it('returns a TestRunResult with passed=true when exitCode is 0', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: 'PASS tests (2 passed)',
        stderr: '',
        exitCode: 0,
      });
      const executor = createExecutor();
      const result = await executor.runTests();

      expect(result).toMatchObject({
        passed: true,
        command: 'npm test 2>&1',
      });
      expect(result.output).toContain('PASS tests (2 passed)');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns a TestRunResult with passed=false when exitCode is non-zero', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: 'FAIL tests (1 failed)',
        stderr: 'Error: test failed',
        exitCode: 1,
      });
      const executor = createExecutor();
      const result = await executor.runTests();

      expect(result.passed).toBe(false);
      expect(result.output).toContain('FAIL tests (1 failed)');
      expect(result.output).toContain('Error: test failed');
    });

    it('runs the test command from runtimeInfo', async () => {
      const executor = createExecutor();
      await executor.runTests();

      expect(mockSandboxInstance.commands.run).toHaveBeenCalledWith(
        'npm test 2>&1',
        expect.objectContaining({ timeoutMs: 300_000 }),
      );
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.runTests()).rejects.toThrow('Sandbox not booted');
    });

    it('throws if runtime not detected', async () => {
      const executor = createExecutor();
      (executor as any).runtimeInfo = null;
      await expect(executor.runTests()).rejects.toThrow('Runtime not detected');
    });
  });

  // ── formatCode() ──────────────────────────────────────────────────────

  describe('formatCode()', () => {
    it('runs the format command from runtimeInfo', async () => {
      const executor = createExecutor();
      await executor.formatCode();

      expect(mockSandboxInstance.commands.run).toHaveBeenCalledWith(
        'npx prettier --write . 2>&1 || true',
        expect.objectContaining({ timeoutMs: 60_000 }),
      );
    });

    it('does nothing when formatCommand is empty', async () => {
      const executor = createExecutor();
      (executor as any).runtimeInfo = {
        language: 'java',
        version: '21',
        testCommand: 'mvn test',
        installCommand: 'mvn dependency:resolve',
        formatCommand: '',
        lintCommand: '',
      };
      await executor.formatCode();

      expect(mockSandboxInstance.commands.run).not.toHaveBeenCalled();
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.formatCode()).rejects.toThrow('Sandbox not booted');
    });

    it('throws if runtime not detected', async () => {
      const executor = createExecutor();
      (executor as any).runtimeInfo = null;
      await expect(executor.formatCode()).rejects.toThrow('Runtime not detected');
    });
  });

  // ── analyzeCode() ─────────────────────────────────────────────────────

  describe('analyzeCode()', () => {
    it('runs the lint command and returns combined output', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: 'No errors found',
        stderr: '',
        exitCode: 0,
      });
      const executor = createExecutor();
      const output = await executor.analyzeCode();

      expect(mockSandboxInstance.commands.run).toHaveBeenCalledWith(
        'npx tsc --noEmit 2>&1',
        expect.objectContaining({ timeoutMs: 120_000 }),
      );
      expect(output).toContain('No errors found');
    });

    it('includes stderr in the output', async () => {
      mockSandboxInstance.commands.run.mockResolvedValue({
        stdout: '',
        stderr: 'Error: type mismatch',
        exitCode: 2,
      });
      const executor = createExecutor();
      const output = await executor.analyzeCode();

      expect(output).toContain('Error: type mismatch');
    });

    it('returns empty string when lintCommand is empty', async () => {
      const executor = createExecutor();
      (executor as any).runtimeInfo = {
        language: 'java',
        version: '21',
        testCommand: 'mvn test',
        installCommand: '',
        formatCommand: '',
        lintCommand: '',
      };
      const output = await executor.analyzeCode();
      expect(output).toBe('');
    });

    it('throws if sandbox not booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.analyzeCode()).rejects.toThrow('Sandbox not booted');
    });

    it('throws if runtime not detected', async () => {
      const executor = createExecutor();
      (executor as any).runtimeInfo = null;
      await expect(executor.analyzeCode()).rejects.toThrow('Runtime not detected');
    });
  });

  // ── destroy() ─────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('calls sandbox.kill()', async () => {
      const executor = createExecutor();
      await executor.destroy();

      expect(mockSandboxInstance.kill).toHaveBeenCalledTimes(1);
    });

    it('sets sandbox to null after destroying', async () => {
      const executor = createExecutor();
      await executor.destroy();

      expect((executor as any).sandbox).toBeNull();
    });

    it('is safe to call multiple times (idempotent)', async () => {
      const executor = createExecutor();
      await executor.destroy();
      await executor.destroy();
      await executor.destroy();

      // kill should only be called once since sandbox is null after first destroy
      expect(mockSandboxInstance.kill).toHaveBeenCalledTimes(1);
    });

    it('handles kill errors gracefully without throwing', async () => {
      mockSandboxInstance.kill.mockRejectedValue(new Error('Connection reset'));
      const executor = createExecutor();

      // Should not throw
      await expect(executor.destroy()).resolves.toBeUndefined();

      // Should log a warning
      const warnCalls = mockLogger.warn.mock.calls;
      expect(warnCalls.some((c: any[]) => String(c).includes('Error destroying'))).toBe(true);
    });

    it('does nothing if sandbox was never booted', async () => {
      const executor = new SandboxExecutor('https://github.com/owner/repo.git', 'owner', 'repo', 123, vi.fn());
      await expect(executor.destroy()).resolves.toBeUndefined();
      expect(mockSandboxInstance.kill).not.toHaveBeenCalled();
    });
  });
});
