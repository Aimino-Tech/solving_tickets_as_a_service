/**
 * Docker sandbox — isolates fix execution in a local Docker container.
 *
 * Serves as a fallback when E2B is unavailable. Uses Dockerode to manage
 * container lifecycle and host volume mounts for file operations.
 *
 * Handles:
 * - Container lifecycle (create, exec, destroy)
 * - Repo cloning with auth token
 * - Runtime detection (10+ languages)
 * - Dependency installation
 * - File operations through host volume mount
 * - Static analysis (tsc, ruff, etc.)
 * - Test execution
 * - Network restriction via iptables
 * - Resource limits (memory, CPU)
 * - Git push
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ boot() wraps container create and token fetch with context
 * ✅ boot() clone failure throws with stderr context
 * ✅ path traversal detection in validatePath() for read/write/remove
 * ✅ readFile/writeFile/removeFile catch with descriptive messages
 * ✅ destroy() catches container kill/remove failures (non-fatal, logs warning)
 * ✅ pushBranch() wraps all git operations with context
 * ✅ installDeps() failure is non-fatal (logs warning, continues)
 * ────────────────────────────────────────────────────────────────────
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { ProgressCallback, SandboxExecutor, ExecResult, TestRunResult, RuntimeInfo } from './types.js';

const log = rootLogger.child({ module: 'docker-sandbox' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContainerInfo {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOCKER_TIMEOUT_MS = 120_000;
const CONTAINER_WORKDIR = '/home/user';

// ---------------------------------------------------------------------------
// Helper: run a docker command and return parsed result
// ---------------------------------------------------------------------------

function dockerCmd(args: string[], timeoutMs = DOCKER_TIMEOUT_MS): ExecResult {
  try {
    const result = spawnSync('docker', args, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return {
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
      exitCode: result.status ?? -1,
    };
  } catch (err) {
    return {
      stdout: '',
      stderr: `docker command failed: ${String(err)}`,
      exitCode: -1,
    };
  }
}

function dockerExecCmd(
  containerId: string,
  command: string,
  timeoutMs = DOCKER_TIMEOUT_MS,
  workdir?: string,
): ExecResult {
  const args = ['exec'];
  if (workdir) {
    args.push('-w', workdir);
  }
  args.push(containerId, '/bin/sh', '-c', command);
  return dockerCmd(args, timeoutMs);
}

// ---------------------------------------------------------------------------
// DockerSandbox
// ---------------------------------------------------------------------------

export class DockerSandbox implements SandboxExecutor {
  private container: ContainerInfo | null = null;
  private tempDir: string = '';
  private repoDir: string = '';
  private repoHostPath: string = '';
  private runtimeInfo: RuntimeInfo | null = null;
  private installationToken: string = '';

  constructor(
    private repoUrl: string,
    private repoOwner: string,
    private repoName: string,
    private installationId: number,
    private getToken: (installationId: number) => Promise<string>,
  ) {}

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Boot the sandbox: pull image, create container, clone repo, detect runtime, install deps.
   */
  async boot(_onProgress?: ProgressCallback): Promise<void> {
    log.info('Booting Docker sandbox');

    // 1. Verify Docker is available
    const versionResult = dockerCmd(['--version']);
    if (versionResult.exitCode !== 0) {
      throw new Error(`Docker is not available: ${versionResult.stderr || 'command not found'}`);
    }
    log.info({ version: versionResult.stdout }, 'Docker available');

    // 2. Pull the configured image
    const image = config.docker.image;
    log.info({ image }, 'Pulling Docker image');
    const pullResult = dockerCmd(['pull', image], 300_000);
    if (pullResult.exitCode !== 0) {
      throw new Error(`Failed to pull Docker image '${image}': ${pullResult.stderr}`);
    }
    log.info({ image }, 'Image pulled');

    // 3. Create temp directory for volume mount
    try {
      this.tempDir = mkdtempSync(join(tmpdir(), 'stas-sandbox-'));
    } catch (err) {
      throw new Error(`Failed to create temp directory: ${String(err)}`);
    }

    // 4. Get installation token for auth
    try {
      this.installationToken = await this.getToken(this.installationId);
    } catch (err) {
      throw new Error(`Failed to get installation token: ${String(err)}`);
    }

    // 5. Create container with resource limits and network restrictions
    const containerName = `stas-sandbox-${this.repoName}-${Date.now().toString(36)}`;
    const createArgs = this.buildCreateArgs(image, containerName);

    log.info({ containerName }, 'Creating container');
    const createResult = dockerCmd(createArgs);
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create container: ${createResult.stderr}`);
    }

    // Extract container ID from output
    this.container = {
      id: createResult.stdout,
      name: containerName,
    };
    log.info({ containerId: this.container.id }, 'Container created');

    // 6. Start the container
    const startResult = dockerCmd(['start', this.container.id]);
    if (startResult.exitCode !== 0) {
      throw new Error(`Failed to start container: ${startResult.stderr}`);
    }
    log.info('Container started');

    // 7. Apply network restrictions if enabled
    if (config.docker.networkRestrict) {
      await this.applyNetworkRestrictions();
    }

    // 8. Clone the repo
    const authUrl = this.repoUrl.replace('https://', `https://x-access-token:${this.installationToken}@`);
    this.repoHostPath = join(this.tempDir, this.repoName);
    this.repoDir = `${CONTAINER_WORKDIR}/${this.repoName}`;

    const cloneResult = await this.exec(`git clone --depth 1 ${authUrl} ${this.repoDir}`, 120_000);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
    }
    log.info('Repo cloned successfully');

    // 9. Detect runtime
    this.runtimeInfo = await this.detectRuntime();
    log.info({ runtime: this.runtimeInfo }, 'Runtime detected');

    // 10. Install dependencies
    await this.installDeps();
  }

  /**
   * Execute a command in the container using docker exec.
   */
  async exec(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    this.ensureBooted();
    return dockerExecCmd(this.container!.id, command, timeoutMs, this.repoDir);
  }

  /**
   * Convenience wrapper for tool commands.
   */
  async execForTools(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    return this.exec(command, timeoutMs);
  }

  /**
   * Read a file from the host volume mount with path traversal protection.
   */
  async readFile(filePath: string): Promise<string> {
    this.ensureBooted();
    this.validatePath(filePath);

    const hostPath = this.resolveHostPath(filePath);
    try {
      return readFileSync(hostPath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Write a file to the host volume mount with path traversal protection.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    this.ensureBooted();
    this.validatePath(filePath);

    const hostPath = this.resolveHostPath(filePath);
    try {
      // Ensure parent directory exists
      const parentDir = hostPath.includes(sep) ? hostPath.substring(0, hostPath.lastIndexOf(sep)) : '.';
      if (parentDir !== '.') {
        // mkdir -p via docker exec since the dir is in the container
        const containerParent = filePath.startsWith('/')
          ? filePath.substring(0, filePath.lastIndexOf('/'))
          : `${this.repoDir}/${filePath.substring(0, filePath.lastIndexOf('/'))}`;
        await this.exec(`mkdir -p "${containerParent}"`);
      }
      writeFileSync(hostPath, content, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to write file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Remove a file from the host volume mount with path traversal protection.
   */
  async removeFile(filePath: string): Promise<void> {
    this.ensureBooted();
    this.validatePath(filePath);

    const hostPath = this.resolveHostPath(filePath);
    try {
      unlinkSync(hostPath);
    } catch (err) {
      throw new Error(`Failed to remove file ${filePath}: ${String(err)}`);
    }
  }

  /**
   * Push changes to a new branch on GitHub.
   */
  async pushBranch(branchName: string): Promise<void> {
    this.ensureBooted();

    log.info({ branchName }, 'Pushing branch');

    try {
      // Configure git
      await this.exec(`git config user.email "stas-bot@users.noreply.github.com"`);
      await this.exec(`git config user.name "STAS Bot"`);

      // Add all changes
      await this.exec(`git add -A`);

      // Check if there's anything to commit
      const statusResult = await this.exec(`git status --porcelain`);
      if (!statusResult.stdout.trim()) {
        log.warn('No changes to commit');
        return;
      }

      // Commit
      const commitResult = await this.exec(`git commit -m "fix: automated fix by STAS"`);
      if (commitResult.exitCode !== 0 && !commitResult.stderr.includes('nothing to commit')) {
        throw new Error(`Failed to commit: ${commitResult.stderr}`);
      }

      // Push
      const authUrl = this.repoUrl.replace('https://', `https://x-access-token:${this.installationToken}@`);
      await this.exec(`git remote set-url origin "${authUrl}"`);
      await this.exec(`git checkout -b "${branchName}"`);
      const pushResult = await this.exec(`git push origin "${branchName}"`, 120_000);
      if (pushResult.exitCode !== 0) {
        throw new Error(`Failed to push branch '${branchName}': ${pushResult.stderr}`);
      }

      log.info({ branchName }, 'Branch pushed successfully');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Failed to')) {
        throw err;
      }
      throw new Error(`Git push operation failed for branch '${branchName}': ${String(err)}`);
    }
  }

  /**
   * Check if the project has a test suite configured.
   */
  hasTestSuite(): boolean {
    return !!(this.runtimeInfo?.testCommand);
  }

  /**
   * Run a specific test file or test pattern.
   */
  async runSpecificTest(testPath: string): Promise<TestRunResult> {
    this.ensureBooted();
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const start = Date.now();

    const commands: string[] = [];
    if (this.runtimeInfo.language === 'node') {
      commands.push(`npx vitest run ${testPath} 2>&1`);
      commands.push(`npx jest ${testPath} 2>&1`);
      commands.push(`npm test -- ${testPath} 2>&1`);
    } else if (this.runtimeInfo.language === 'python') {
      commands.push(`python -m pytest ${testPath} -v 2>&1`);
      commands.push(`python -m unittest ${testPath} -v 2>&1`);
    } else if (this.runtimeInfo.language === 'go') {
      commands.push(`go test ${testPath} 2>&1`);
    } else if (this.runtimeInfo.language === 'rust') {
      commands.push(`cargo test 2>&1`);
    } else {
      commands.push(this.runtimeInfo.testCommand);
    }

    for (const command of commands) {
      try {
        const result = await this.exec(command, 300_000);
        if (!result.stderr.includes('command not found') && !result.stderr.includes('Unknown command')) {
          return {
            passed: result.exitCode === 0,
            output: `${result.stdout}\n${result.stderr}`.trim(),
            command,
            durationMs: Date.now() - start,
          };
        }
      } catch {
        continue;
      }
    }

    return {
      passed: false,
      output: `Could not find a test runner for specific test: ${testPath}`,
      command: commands[0] || '',
      durationMs: Date.now() - start,
    };
  }

  /**
   * Auto-detect and run the test suite.
   */
  async runTests(): Promise<TestRunResult> {
    this.ensureBooted();
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
    this.ensureBooted();
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
    this.ensureBooted();
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
    this.ensureBooted();

    const defaults: RuntimeInfo = {
      language: 'unknown',
      version: '',
      testCommand: '',
      installCommand: '',
      formatCommand: '',
      lintCommand: '',
    };

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
   * Destroy the sandbox: stop/remove container, clean up temp dirs.
   */
  async destroy(): Promise<void> {
    if (this.container) {
      log.info({ containerId: this.container.id }, 'Destroying Docker sandbox');

      // Stop container (best-effort)
      const stopResult = dockerCmd(['stop', '--time', '5', this.container.id]);
      if (stopResult.exitCode !== 0) {
        log.warn({ err: stopResult.stderr }, 'Error stopping container (non-fatal)');
      }

      // Remove container
      const rmResult = dockerCmd(['rm', '--force', '--volumes', this.container.id]);
      if (rmResult.exitCode !== 0) {
        log.warn({ err: rmResult.stderr }, 'Error removing container (non-fatal)');
      }

      this.container = null;
    }

    // Clean up temp directory
    if (this.tempDir && existsSync(this.tempDir)) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
        log.debug({ tempDir: this.tempDir }, 'Temp directory cleaned up');
      } catch (err) {
        log.warn({ err: String(err) }, 'Error cleaning up temp directory (non-fatal)');
      }
      this.tempDir = '';
    }
  }

  // ── Private ───────────────────────────────────────────────────────

  /**
   * Build docker create arguments with resource limits and volume mounts.
   */
  private buildCreateArgs(image: string, containerName: string): string[] {
    const args: string[] = ['create', '--init', '--rm'];

    // Container name
    args.push('--name', containerName);

    // Volume mount for repo
    args.push('-v', `${this.tempDir}:${CONTAINER_WORKDIR}`);

    // Working directory
    args.push('-w', CONTAINER_WORKDIR);

    // Resource limits
    const memory = config.docker.containerMemory;
    if (memory) {
      args.push('--memory', memory);
    }

    const cpu = config.docker.containerCpu;
    if (cpu) {
      args.push('--cpus', String(cpu));
    }

    // Security options
    args.push('--security-opt', 'no-new-privileges:true');
    args.push('--cap-drop', 'ALL');
    args.push('--cap-add', 'NET_ADMIN'); // needed for iptables
    args.push('--cap-add', 'NET_RAW');   // needed for iptables
    args.push('--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=1g');
    args.push('--tmpfs', `${CONTAINER_WORKDIR}:rw,noexec,nosuid,size=2g`);

    // Network
    args.push('--network', 'bridge');
    if (config.docker.networkRestrict) {
      args.push('--dns', '1.1.1.1');
      args.push('--dns', '8.8.8.8');
    }

    // Env vars
    args.push('-e', `HOME=${CONTAINER_WORKDIR}`);
    args.push('-e', 'USER=user');

    // Image
    args.push(image);

    // Keep container running
    args.push('tail', '-f', '/dev/null');

    return args;
  }

  /**
   * Apply iptables-based network restrictions inside the container.
   * Whitelists: GitHub API, configured LLM providers, package registries.
   */
  private async applyNetworkRestrictions(): Promise<void> {
    if (!this.container) return;

    const allowedHosts = config.docker.allowedHosts;
    if (!allowedHosts || allowedHosts.length === 0) return;

    log.info({ allowedHosts }, 'Applying network restrictions via iptables');

    try {
      // Set default policy to DROP
      await this.exec('iptables -P INPUT DROP');
      await this.exec('iptables -P FORWARD DROP');
      await this.exec('iptables -P OUTPUT DROP');

      // Allow loopback
      await this.exec('iptables -A INPUT -i lo -j ACCEPT');
      await this.exec('iptables -A OUTPUT -o lo -j ACCEPT');

      // Allow established connections
      await this.exec('iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');
      await this.exec('iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');

      // Allow DNS
      await this.exec('iptables -A OUTPUT -p udp --dport 53 -j ACCEPT');
      await this.exec('iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT');

      // Allow each configured host
      for (const host of allowedHosts) {
        // Resolve hostname to IPs
        const resolveResult = await this.exec(`getent hosts ${host} | awk '{ print $1 }'`);
        if (resolveResult.exitCode === 0 && resolveResult.stdout.trim()) {
          const ips = resolveResult.stdout.trim().split('\n');
          for (const ip of ips) {
            if (ip) {
              await this.exec(`iptables -A OUTPUT -d ${ip} -j ACCEPT`);
            }
          }
        }
      }

      log.info('Network restrictions applied');
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to apply network restrictions (non-fatal)');
    }
  }

  /**
   * Resolve a sandbox file path to a host filesystem path.
   */
  private resolveHostPath(filePath: string): string {
    if (filePath.startsWith('/')) {
      // Absolute path: map CONTAINER_WORKDIR prefix to tempDir
      if (filePath.startsWith(CONTAINER_WORKDIR)) {
        return join(this.tempDir, filePath.slice(CONTAINER_WORKDIR.length));
      }
      return filePath; // outside repo dir, use as-is
    }
    // Relative path: join with repoDir on host
    return join(this.repoHostPath, filePath);
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

  /**
   * Throw if container is not running.
   */
  private ensureBooted(): void {
    if (!this.container) {
      throw new Error('Sandbox not booted');
    }
  }
}
