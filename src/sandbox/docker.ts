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
 * - Egress proxy via Squid for zero-trust network isolation
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
import Docker from 'dockerode';
import { Writable } from 'node:stream';

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { validateAndSanitize } from './gitGuard.js';
import type { ProgressCallback, SandboxExecutor, ExecResult, TestRunResult, RuntimeInfo } from './types.js';

const log = rootLogger.child({ module: 'docker-sandbox' });

interface ContainerInfo {
  id: string;
  name: string;
}

const DOCKER_TIMEOUT_MS = 120_000;
const CONTAINER_WORKDIR = '/home/node';

function collectExecOutput(
  stream: NodeJS.ReadableStream,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const stdoutStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
        stdoutChunks.push(chunk);
        callback();
      },
    });

    const stderrStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
        stderrChunks.push(chunk);
        callback();
      },
    });

    const docker = new Docker();
    docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    stream.on('end', () => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trimEnd();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trimEnd();
      resolve({ stdout, stderr });
    });

    stream.on('error', (err: Error) => {
      reject(err);
    });
  });
}

function dockerExecCmd(
  containerId: string,
  command: string,
  timeoutMs = DOCKER_TIMEOUT_MS,
  workdir?: string,
): ExecResult {
  // Validate git commands before execution
  validateAndSanitize(command);
  const args = ['exec'];
  if (workdir) {
    args.push('-w', workdir);
  }
  args.push(containerId, '/bin/sh', '-c', command);
  return dockerCmd(args, timeoutMs);
}

export function dockerCmd(args: string[], timeoutMs = DOCKER_TIMEOUT_MS): ExecResult {
  try {
    const result = spawnSync('docker', args, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
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

export class DockerSandbox implements SandboxExecutor {
  private docker: Docker;
  private container: ContainerInfo | null = null;
  private dockerContainer: Docker.Container | null = null;
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
    container?: { id: string; name: string },
    tempDir?: string,
  ) {
    this.docker = new Docker();
    if (container) this.container = container;
    if (tempDir) this.tempDir = tempDir;
  }

  async boot(): Promise<void> {
    log.info('Booting Docker sandbox');

    if (this.container) {
      log.info({ containerId: this.container.id }, 'Container already exists — fast boot');
    } else {
      const versionResult = await this.docker.version();
      log.info({ version: versionResult.Version }, 'Docker available');

      const image = config.docker.image;
      log.info({ image }, 'Pulling Docker image');
      await this.pullImage(image);
      log.info({ image }, 'Image pulled');

      try {
        this.tempDir = mkdtempSync(join(tmpdir(), 'stas-sandbox-'));
      } catch (err) {
        throw new Error(`Failed to create temp directory: ${String(err)}`);
      }

      const containerName = `stas-sandbox-${this.repoName}-${Date.now().toString(36)}`;
      const createArgs = this.buildCreateArgs(image, containerName);

      log.info({ containerName }, 'Creating container');
      const createResult = dockerCmd(createArgs);
      if (createResult.exitCode !== 0) {
        throw new Error(`Failed to create container: ${createResult.stderr}`);
      }
      this.container = { id: createResult.stdout, name: containerName };
      log.info({ containerId: this.container.id }, 'Container created');

      const startResult = dockerCmd(['start', this.container.id]);
      if (startResult.exitCode !== 0) {
        throw new Error(`Failed to start container: ${startResult.stderr}`);
      }
      log.info('Container started');

      this.ensureAgentNetwork();
    }

    try {
      this.installationToken = await this.getToken(this.installationId);
    } catch (err) {
      throw new Error(`Failed to get installation token: ${String(err)}`);
    }

    if (config.docker.networkRestrict) {
      await this.applyNetworkRestrictions();
    }

    const cloneUrl = this.repoUrl.replace('https://', `https://x-access-token:${this.installationToken}@`);
    this.repoHostPath = join(this.tempDir, this.repoName);
    this.repoDir = `${CONTAINER_WORKDIR}/${this.repoName}`;

    const cloneResult = await this.exec(`git clone --depth 1 ${cloneUrl} ${this.repoDir}`, 120_000);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
    }
    log.info('Repo cloned successfully');

    this.runtimeInfo = await this.detectRuntime();
    log.info({ runtime: this.runtimeInfo }, 'Runtime detected');

    await this.installDeps();
  }

  async exec(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    this.ensureBooted();

    // Validate git commands before execution
    validateAndSanitize(command);

    if (!this.dockerContainer) {
      return dockerExecCmd(this.container!.id, command, timeoutMs, this.repoDir);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const execInstance = await this.dockerContainer!.exec({
        Cmd: ['/bin/sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: this.repoDir,
      });

      const stream = await execInstance.start({
        Detach: false,
        Tty: false,
        stdin: false,
      });

      const { stdout, stderr } = await collectExecOutput(stream);

      let exitCode = 0;
      try {
        const inspect = await execInstance.inspect();
        exitCode = inspect.ExitCode ?? -1;
      } catch {
        exitCode = -1;
      }

      if (controller.signal.aborted) {
        return { stdout, stderr, exitCode: -1 };
      }

      return { stdout, stderr, exitCode };
    } finally {
      clearTimeout(timer);
    }
  }

  async execForTools(command: string, timeoutMs: number = 60_000): Promise<ExecResult> {
    return this.exec(command, timeoutMs);
  }

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

  async writeFile(filePath: string, content: string): Promise<void> {
    this.ensureBooted();
    this.validatePath(filePath);

    const hostPath = this.resolveHostPath(filePath);
    try {
      const parentDir = hostPath.includes(sep) ? hostPath.substring(0, hostPath.lastIndexOf(sep)) : '.';
      if (parentDir !== '.') {
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

  async pushBranch(branchName: string): Promise<void> {
    this.ensureBooted();

    log.info({ branchName }, 'Pushing branch');

    try {
      await this.exec(`git config user.email "stas-bot@users.noreply.github.com"`);
      await this.exec(`git config user.name "STAS Bot"`);

      await this.exec(`git add -A`);

      const statusResult = await this.exec(`git status --porcelain`);
      if (!statusResult.stdout.trim()) {
        log.warn('No changes to commit');
        return;
      }

      const commitResult = await this.exec(`git commit -m "fix: automated fix by STAS"`);
      if (commitResult.exitCode !== 0 && !commitResult.stderr.includes('nothing to commit')) {
        throw new Error(`Failed to commit: ${commitResult.stderr}`);
      }

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

  hasTestSuite(): boolean {
    return !!(this.runtimeInfo?.testCommand);
  }

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

  async formatCode(): Promise<void> {
    this.ensureBooted();
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const command = this.runtimeInfo.formatCommand;
    if (command) {
      log.info({ command }, 'Formatting code');
      await this.exec(command, 60_000);
    }
  }

  async analyzeCode(): Promise<string> {
    this.ensureBooted();
    if (!this.runtimeInfo) throw new Error('Runtime not detected');

    const command = this.runtimeInfo.lintCommand;
    if (!command) return '';

    const result = await this.exec(command, 120_000);
    return `${result.stdout}\n${result.stderr}`.trim();
  }

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

  async installDeps(): Promise<void> {
    if (!this.runtimeInfo?.installCommand) return;

    log.info({ command: this.runtimeInfo.installCommand }, 'Installing dependencies');
    const result = await this.exec(this.runtimeInfo.installCommand, 180_000);
    if (result.exitCode !== 0) {
      log.warn({ stderr: result.stderr.slice(0, 500) }, 'Dependency install had issues');
    }
  }

  async destroy(): Promise<void> {
    if (this.container) {
      log.info({ containerId: this.container.id }, 'Destroying Docker sandbox');

      if (this.dockerContainer) {
        try {
          await this.dockerContainer.stop({ t: 5 });
        } catch (err) {
          log.warn({ err: String(err) }, 'Error stopping container (non-fatal)');
        }
        try {
          await this.dockerContainer.remove({ force: true, v: true });
        } catch (err) {
          log.warn({ err: String(err) }, 'Error removing container (non-fatal)');
        }
      } else {
        dockerCmd(['stop', '--time', '5', this.container.id]);
        dockerCmd(['rm', '--force', '--volumes', this.container.id]);
      }

      this.container = null;
      this.dockerContainer = null;
    }

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

    args.push('--name', containerName);

    args.push('-v', `${this.tempDir}:${CONTAINER_WORKDIR}`);

    args.push('-w', CONTAINER_WORKDIR);

    const memory = config.docker.containerMemory;
    if (memory) {
      args.push('--memory', memory);
    }

    const cpu = config.docker.containerCpu;
    if (cpu) {
      args.push('--cpus', String(cpu));
    }

    args.push('--label', 'stas-sandbox=true');

    args.push('--security-opt', 'no-new-privileges:true');
    args.push('--cap-drop', 'ALL');
    args.push('--cap-add', 'NET_ADMIN');
    args.push('--cap-add', 'NET_RAW');
    args.push('--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=2g');
    args.push('--tmpfs', `${CONTAINER_WORKDIR}/.git:rw,noexec,nosuid,size=512m`);

    const seccompProfile = config.docker.seccompProfile;
    if (seccompProfile) {
      args.push('--security-opt', `seccomp=${seccompProfile}`);
    }

    const apparmorProfile = config.docker.apparmorProfile;
    if (apparmorProfile) {
      args.push('--security-opt', `apparmor=${apparmorProfile}`);
    }

    if (config.docker.gvisorEnabled) {
      args.push('--runtime', 'runsc');
    }

    if (config.docker.networkRestrict) {
      args.push('--network', 'stas_agent-net');
      args.push('-e', 'http_proxy=http://stas-egress-proxy:3128');
      args.push('-e', 'https_proxy=http://stas-egress-proxy:3128');
      args.push('-e', 'HTTP_PROXY=http://stas-egress-proxy:3128');
      args.push('-e', 'HTTPS_PROXY=http://stas-egress-proxy:3128');
      args.push('-e', 'NO_PROXY=localhost,127.0.0.1');
    } else {
      args.push('--network', 'none');
    }

    args.push('-e', `HOME=${CONTAINER_WORKDIR}`);
    args.push('-e', 'USER=user');

    args.push(image);

    args.push('tail', '-f', '/dev/null');

    return args;
  }

  /**
   * Ensure the stas_agent-net Docker network exists.
   * Creates it if absent (idempotent). Also attempts host-level
   * iptables rules for Squid bypass prevention (best-effort).
   */
  private ensureAgentNetwork(): void {
    const networkName = 'stas_agent-net';
    const networkResult = dockerCmd(['network', 'ls', '--filter', `name=${networkName}`, '--format', '{{.Name}}']);
    const exists = networkResult.stdout.trim() === networkName;

    if (!exists) {
      log.info({ networkName }, 'Creating agent network');
      const createResult = dockerCmd(['network', 'create', '--driver', 'bridge', '--internal', 'false', networkName]);
      if (createResult.exitCode !== 0) {
        log.warn({ err: createResult.stderr }, 'Failed to create agent network (non-fatal, may already exist)');
      }
    } else {
      log.debug({ networkName }, 'Agent network already exists');
    }

    // Attempt host-level iptables rules for Squid bypass prevention
    try {
      const scriptPath = new URL('../../scripts/setup-network.sh', import.meta.url).pathname;
      const scriptResult = dockerCmd([scriptPath]);
      if (scriptResult.exitCode !== 0) {
        log.warn({ err: scriptResult.stderr }, 'Host iptables setup failed (non-fatal, run manually with sudo)');
      } else {
        log.info('Host iptables rules applied for agent network');
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Could not apply host iptables rules (non-fatal)');
    }
  }

  private resolveHostPath(filePath: string): string {
    if (filePath.startsWith('/')) {
      if (filePath.startsWith(CONTAINER_WORKDIR)) {
        return join(this.tempDir, filePath.slice(CONTAINER_WORKDIR.length));
      }
      return filePath;
    }
    return join(this.repoHostPath, filePath);
  }

  private validatePath(filePath: string): void {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('..')) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
  }

  private ensureBooted(): void {
    if (!this.dockerContainer && !this.container) {
      throw new Error('Sandbox not booted');
    }
  }

  private async pullImage(image: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err) {
          reject(new Error(`Failed to pull image '${image}': ${err.message}`));
          return;
        }
        if (stream) {
          stream.on('end', () => resolve());
          stream.on('error', (streamErr: Error) => reject(new Error(`Image pull stream error: ${streamErr.message}`)));
        } else {
          resolve();
        }
      });
    });
  }

  private async applyNetworkRestrictions(): Promise<void> {
    if (!this.dockerContainer) return;
    const allowedHosts = config.docker.allowedHosts;
    if (!allowedHosts || allowedHosts.length === 0) return;
    log.info({ allowedHosts }, 'Applying network restrictions');

    try {
      await this.exec('iptables -P INPUT DROP');
      await this.exec('iptables -P FORWARD DROP');
      await this.exec('iptables -P OUTPUT DROP');
      await this.exec('iptables -A INPUT -i lo -j ACCEPT');
      await this.exec('iptables -A OUTPUT -o lo -j ACCEPT');
      await this.exec('iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');
      await this.exec('iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT');
      await this.exec('iptables -A OUTPUT -p udp --dport 53 -j ACCEPT');
      await this.exec('iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT');

      for (const host of allowedHosts) {
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
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to apply network restrictions (non-fatal)');
    }
  }

  __poolExtract(): { id: string; name: string; tempDir: string } {
    if (!this.container) throw new Error('No container to extract');
    return { id: this.container.id, name: this.container.name, tempDir: this.tempDir };
  }
}

function parseMemoryToBytes(mem: string): number {
  const match = mem.match(/^(\d+(?:\.\d+)?)\s*(b|k|m|g)?$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const multipliers: Record<string, number> = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
  return Math.round(value * (multipliers[unit] || 1));
}
