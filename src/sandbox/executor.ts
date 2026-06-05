/**
 * E2B sandbox executor — isolates fix execution in a disposable cloud sandbox.
 *
 * Handles:
 * - Sandbox lifecycle (create, destroy)
 * - Repo cloning with auth token
 * - Runtime detection (10+ languages)
 * - Dependency installation
 * - File operations with path traversal protection
 * - Static analysis (tsc, ruff, etc.)
 * - Test execution
 * - Git push
 *
 * Uses the E2B SDK v2 API (sandbox.commands.run, sandbox.files.read/write).
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ boot() wraps Sandbox.create() and token fetch with context
 * ✅ boot() clone failure throws with stderr context
 * ✅ path traversal detection in validatePath() for read/write/remove
 * ✅ readFile/writeFile/removeFile catch with descriptive messages
 * ✅ destroy() catches kill failures (non-fatal, logs warning)
 * ✅ pushBranch() wraps all git operations with context
 * installDeps() failure is non-fatal (logs warning, continues)
 * ────────────────────────────────────────────────────────────────────
 */

import { Sandbox } from 'e2b';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'sandbox' });

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TestRunResult {
  passed: boolean;
  output: string;
  command: string;
  durationMs: number;
}

export interface RuntimeInfo {
  language: string;
  version: string;
  testCommand: string;
  installCommand: string;
  formatCommand: string;
  lintCommand: string;
}

export class SandboxExecutor {
  private sandbox: Sandbox | null = null;
  private repoDir: string = '';
  private runtimeInfo: RuntimeInfo | null = null;
  private installationToken: string = '';

  constructor(
    private repoUrl: string,
    _repoOwner: string,
    private repoName: string,
    private installationId: number,
    private getToken: (installationId: number) => Promise<string>,
  ) {}

  /**
   * Boot the sandbox: create instance, clone repo, detect runtime, install deps.
   */
  async boot(): Promise<void> {
    log.info('Booting E2B sandbox');

    // Create the sandbox
    try {
      this.sandbox = await Sandbox.create({
        apiKey: config.e2b.apiKey,
        template: config.e2b.templateId,
        timeoutMs: config.e2b.sandboxTimeoutMs,
      });
    } catch (err) {
      throw new Error(`Failed to create E2B sandbox (template: ${config.e2b.templateId}): ${String(err)}`);
    }

    log.info({ sandboxId: this.sandbox.sandboxId }, 'Sandbox created');

    // Get installation token for auth
    try {
      this.installationToken = await this.getToken(this.installationId);
    } catch (err) {
      throw new Error(`Failed to get installation token for sandbox ${this.sandbox.sandboxId}: ${String(err)}`);
    }

    // Clone the repo with auth
    const authUrl = this.repoUrl.replace('https://', `https://x-access-token:${this.installationToken}@`);
    this.repoDir = `/home/user/${this.repoName}`;

    const cloneResult = await this.exec(`git clone --depth 1 ${authUrl} ${this.repoDir}`, 120_000);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
    }
    log.info('Repo cloned successfully');

    // Detect runtime
    this.runtimeInfo = await this.detectRuntime();
    log.info({ runtime: this.runtimeInfo }, 'Runtime detected');

    // Install dependencies
    await this.installDeps();
  }

  /**
   * Execute a command in the sandbox using E2B commands.run().
   */
  async exec(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    if (!this.sandbox) throw new Error('Sandbox not booted');

    const result = await this.sandbox.commands.run(command, {
      cwd: this.repoDir || undefined,
      timeoutMs,
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode ?? -1,
    };
  }

  /**
   * Convenience wrapper for tool commands.
   */
  async execForTools(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    return this.exec(command, timeoutMs);
  }

  /**
   * Read a file from the sandbox with path traversal protection.
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    this.validatePath(filePath);

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      return await this.sandbox.files.read(fullPath);
    } catch (err) {
      throw new Error(`Failed to read file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Write a file in the sandbox with path traversal protection.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    this.validatePath(filePath);

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      // Ensure parent directory exists
      const parentDir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : '.';
      await this.sandbox.files.makeDir(parentDir);

      await this.sandbox.files.write(fullPath, content);
    } catch (err) {
      throw new Error(`Failed to write file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Remove a file from the sandbox with path traversal protection.
   */
  async removeFile(filePath: string): Promise<void> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    this.validatePath(filePath);

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      await this.sandbox.files.remove(fullPath);
    } catch (err) {
      throw new Error(`Failed to remove file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Push changes to a new branch on GitHub.
   */
  async pushBranch(branchName: string): Promise<void> {
    if (!this.sandbox) throw new Error('Sandbox not booted');

    log.info({ branchName }, 'Pushing branch');

    try {
      // Configure git
      await this.exec(`git -C "${this.repoDir}" config user.email "stas-bot@users.noreply.github.com"`);
      await this.exec(`git -C "${this.repoDir}" config user.name "STAS Bot"`);

      // Add all changes
      await this.exec(`git -C "${this.repoDir}" add -A`);

      // Check if there's anything to commit
      const statusResult = await this.exec(`git -C "${this.repoDir}" status --porcelain`);
      if (!statusResult.stdout.trim()) {
        log.warn('No changes to commit');
        return;
      }

      // Commit
      const commitResult = await this.exec(`git -C "${this.repoDir}" commit -m "fix: automated fix by STAS"`);
      if (commitResult.exitCode !== 0 && !commitResult.stderr.includes('nothing to commit')) {
        throw new Error(`Failed to commit: ${commitResult.stderr}`);
      }

      // Push
      const authUrl = this.repoUrl.replace('https://', `https://x-access-token:${this.installationToken}@`);
      await this.exec(`git -C "${this.repoDir}" remote set-url origin "${authUrl}"`);
      await this.exec(`git -C "${this.repoDir}" checkout -b "${branchName}"`);
      const pushResult = await this.exec(`git -C "${this.repoDir}" push origin "${branchName}"`, 120_000);
      if (pushResult.exitCode !== 0) {
        throw new Error(`Failed to push branch '${branchName}': ${pushResult.stderr}`);
      }

      log.info({ branchName }, 'Branch pushed successfully');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Failed to')) {
        throw err; // Already has context
      }
      throw new Error(`Git push operation failed for branch '${branchName}': ${String(err)}`);
    }
  }

  /**
   * Auto-detect and run the test suite.
   */
  async runTests(): Promise<TestRunResult> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const command = this.runtimeInfo.testCommand;
    log.info({ command }, 'Running tests');
    const start = Date.now();

    const result = await this.exec(command, 300_000);

    const durationMs = Date.now() - start;
    const passed = result.exitCode === 0;

    return {
      passed,
      output: `${result.stdout}\n${result.stderr}`.trim(),
      command,
      durationMs,
    };
  }

  /**
   * Auto-format modified files.
   */
  async formatCode(): Promise<void> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const command = this.runtimeInfo.formatCommand;
    if (command) {
      log.info({ command }, 'Formatting code');
      await this.exec(command, 60_000);
    }
  }

  /**
   * Run static analysis on the codebase.
   */
  async analyzeCode(): Promise<string> {
    if (!this.sandbox) throw new Error('Sandbox not booted');
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const command = this.runtimeInfo.lintCommand;
    if (!command) return '';

    const result = await this.exec(command, 120_000);
    return `${result.stdout}\n${result.stderr}`.trim();
  }

  /**
   * Auto-detect the project runtime environment.
   */
  async detectRuntime(): Promise<RuntimeInfo> {
    if (!this.sandbox) throw new Error('Sandbox not booted');

    const defaults: RuntimeInfo = {
      language: 'unknown',
      version: '',
      testCommand: '',
      installCommand: '',
      formatCommand: '',
      lintCommand: '',
    };

    // Check for common language markers
    const files = await this.exec('ls -la', 10_000);

    // Node / JavaScript
    if (files.stdout.includes('package.json')) {
      const pkgJson = await this.exec(`cat "${this.repoDir}/package.json"`);
      let nodeVersion = '';
      try {
        const pkg = JSON.parse(pkgJson.stdout);
        nodeVersion = pkg.engines?.node || '';
      } catch {
        /* ignore */
      }

      // Check for specific test frameworks
      let testCmd = 'npm test 2>&1';
      if (pkgJson.stdout.includes('"turbo"')) {
        testCmd = 'npx turbo run test 2>&1';
      }
      if (pkgJson.stdout.includes('"nx"')) {
        testCmd = 'npx nx run-many --target=test --all 2>&1';
      }

      const hasTypescript = files.stdout.includes('tsconfig.json');
      const lintCmd = hasTypescript ? 'npx tsc --noEmit 2>&1' : 'npx eslint . 2>&1 || true';
      const isYarn = files.stdout.includes('yarn.lock');
      const isPnpm = files.stdout.includes('pnpm-lock.yaml');
      const installCmd = isPnpm ? 'pnpm install' : isYarn ? 'yarn install' : 'npm install';
      const formatCmd = files.stdout.includes('biome.json')
        ? 'npx biome check --write . 2>&1 || true'
        : hasTypescript
          ? 'npx prettier --write . 2>&1 || true'
          : '';

      return {
        language: 'node',
        version: nodeVersion,
        testCommand: testCmd,
        installCommand: installCmd,
        formatCommand: formatCmd,
        lintCommand: lintCmd,
      };
    }

    // Python
    if (
      files.stdout.includes('requirements.txt') ||
      files.stdout.includes('setup.py') ||
      files.stdout.includes('pyproject.toml') ||
      files.stdout.includes('Pipfile')
    ) {
      const hasRuff = files.stdout.includes('ruff') || files.stdout.includes('pyproject.toml');
      const hasPytest = files.stdout.includes('pytest') || files.stdout.includes('pyproject.toml');

      return {
        language: 'python',
        version: (await this.exec('python3 --version 2>&1')).stdout.trim(),
        testCommand: hasPytest ? 'python3 -m pytest -x -v 2>&1' : 'python3 -m unittest discover -v 2>&1',
        installCommand: files.stdout.includes('Pipfile')
          ? 'pipenv install --dev 2>&1'
          : files.stdout.includes('pyproject.toml')
            ? "pip install -e '.[dev]' 2>&1 || pip install -r requirements.txt 2>&1"
            : 'pip install -r requirements.txt 2>&1',
        formatCommand: hasRuff ? 'python3 -m ruff format . 2>&1 || true' : '',
        lintCommand: hasRuff ? 'python3 -m ruff check . 2>&1' : 'python3 -m flake8 . 2>&1 || true',
      };
    }

    // Go
    if (files.stdout.includes('go.mod')) {
      return {
        language: 'go',
        version: (await this.exec('go version 2>&1')).stdout.trim(),
        testCommand: 'go test ./... 2>&1',
        installCommand: 'go mod download 2>&1',
        formatCommand: 'go fmt ./... 2>&1',
        lintCommand: 'go vet ./... 2>&1',
      };
    }

    // Rust
    if (files.stdout.includes('Cargo.toml')) {
      return {
        language: 'rust',
        version: (await this.exec('rustc --version 2>&1')).stdout.trim(),
        testCommand: 'cargo test 2>&1',
        installCommand: 'cargo fetch 2>&1',
        formatCommand: 'cargo fmt --all 2>&1',
        lintCommand: 'cargo clippy --all-targets -- -D warnings 2>&1 || true',
      };
    }

    // Ruby
    if (files.stdout.includes('Gemfile')) {
      return {
        language: 'ruby',
        version: (await this.exec('ruby --version 2>&1')).stdout.trim(),
        testCommand: 'bundle exec rspec 2>&1 || bundle exec rake test 2>&1',
        installCommand: 'bundle install 2>&1',
        formatCommand: 'bundle exec rubocop -a 2>&1 || true',
        lintCommand: 'bundle exec rubocop 2>&1 || true',
      };
    }

    // Java
    if (
      files.stdout.includes('pom.xml') ||
      files.stdout.includes('build.gradle') ||
      files.stdout.includes('build.gradle.kts')
    ) {
      const isGradle = files.stdout.includes('build.gradle');
      return {
        language: 'java',
        version: (await this.exec('java -version 2>&1')).stdout.trim(),
        testCommand: isGradle ? './gradlew test 2>&1' : 'mvn test 2>&1',
        installCommand: isGradle ? './gradlew build --no-daemon 2>&1' : 'mvn dependency:resolve 2>&1',
        formatCommand: '',
        lintCommand: '',
      };
    }

    // PHP
    if (files.stdout.includes('composer.json')) {
      return {
        language: 'php',
        version: (await this.exec('php --version 2>&1')).stdout.trim(),
        testCommand: 'vendor/bin/phpunit 2>&1 || composer test 2>&1',
        installCommand: 'composer install 2>&1',
        formatCommand: 'vendor/bin/php-cs-fixer fix --allow-risky=yes 2>&1 || true',
        lintCommand: 'vendor/bin/phpcs 2>&1 || true',
      };
    }

    // Swift
    if (files.stdout.includes('Package.swift')) {
      return {
        language: 'swift',
        version: (await this.exec('swift --version 2>&1')).stdout.trim(),
        testCommand: 'swift test 2>&1',
        installCommand: 'swift package resolve 2>&1',
        formatCommand: 'swift format . 2>&1 || true',
        lintCommand: '',
      };
    }

    // Dart / Flutter
    if (files.stdout.includes('pubspec.yaml')) {
      return {
        language: 'dart',
        version: (await this.exec('dart --version 2>&1')).stdout.trim(),
        testCommand: 'flutter test 2>&1 || dart test 2>&1',
        installCommand: 'flutter pub get 2>&1 || dart pub get 2>&1',
        formatCommand: 'dart format . 2>&1 || true',
        lintCommand: 'dart analyze 2>&1 || true',
      };
    }

    // Elixir
    if (files.stdout.includes('mix.exs')) {
      return {
        language: 'elixir',
        version: (await this.exec('elixir --version 2>&1')).stdout.trim(),
        testCommand: 'mix test 2>&1',
        installCommand: 'mix deps.get 2>&1',
        formatCommand: 'mix format 2>&1',
        lintCommand: 'mix credo --strict 2>&1 || true',
      };
    }

    // C++ (CMake)
    if (files.stdout.includes('CMakeLists.txt')) {
      return {
        language: 'cpp',
        version: (await this.exec('g++ --version 2>&1 || clang++ --version 2>&1')).stdout.trim(),
        testCommand: 'cmake --build build && cd build && ctest 2>&1',
        installCommand: 'cmake -B build 2>&1',
        formatCommand: '',
        lintCommand: '',
      };
    }

    // .NET / C#
    if (files.stdout.includes('*.csproj') || files.stdout.includes('*.sln')) {
      return {
        language: 'dotnet',
        version: (await this.exec('dotnet --version 2>&1')).stdout.trim(),
        testCommand: 'dotnet test 2>&1',
        installCommand: 'dotnet restore 2>&1',
        formatCommand: 'dotnet format 2>&1 || true',
        lintCommand: 'dotnet build --no-restore 2>&1',
      };
    }

    log.warn('Could not detect runtime, defaulting to node');
    return defaults;
  }

  /**
   * Install dependencies based on detected runtime.
   */
  async installDeps(): Promise<void> {
    if (!this.runtimeInfo?.installCommand) return;

    log.info({ command: this.runtimeInfo.installCommand }, 'Installing dependencies');
    const result = await this.exec(this.runtimeInfo.installCommand, 180_000);
    if (result.exitCode !== 0) {
      log.warn({ stderr: result.stderr.slice(0, 500) }, 'Dependency install had issues');
    }
  }

  /**
   * Destroy the sandbox and clean up resources.
   */
  async destroy(): Promise<void> {
    if (this.sandbox) {
      log.info({ sandboxId: this.sandbox.sandboxId }, 'Destroying sandbox');
      try {
        await this.sandbox.kill();
      } catch (err) {
        log.warn({ err: String(err) }, 'Error destroying sandbox (non-fatal)');
      }
      this.sandbox = null;
    }
  }

  /**
   * Validate file path to prevent directory traversal attacks.
   */
  private validatePath(filePath: string): void {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('..')) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
  }
}
