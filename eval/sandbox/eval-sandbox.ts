import { Sandbox } from 'e2b';
import { config } from '../../src/config.js';
import { rootLogger } from '../../src/utils/logger.js';
import { EvalTimeoutError, EvalSandboxError } from './types.js';
import type { EvalTestCase, EvalResult } from './types.js';
import type { SandboxExecutor, ExecResult } from '../../src/sandbox/types.js';

const log = rootLogger.child({ module: 'eval-sandbox' });

const SENSITIVE_ENV_PATTERNS = [
  /^API_KEY/i,
  /^TOKEN/i,
  /^SECRET/i,
  /^PASSWORD/i,
  /^CREDENTIAL/i,
  /^AUTH/i,
  /^OPENAI/i,
  /^ANTHROPIC/i,
  /^OPENCODE/i,
  /^E2B_/i,
  /^STRIPE_/i,
  /^GITHUB_/i,
  /^GITLAB_/i,
  /^LINEAR_/i,
  /^JIRA_/i,
  /^SLACK_/i,
  /^SENTRY_/i,
  /^ADMIN_/i,
  /^DATABASE_/i,
];

export function sanitizeEnvironment(env: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (!isSensitive) {
      clean[key] = value;
    } else {
      log.debug({ key }, 'Scrubbed sensitive env var from sandbox');
    }
  }
  return clean;
}

export function createEvalSandbox(
  testCase: EvalTestCase,
  getToken?: (installationId: number) => Promise<string>,
  installationId?: number,
): EvalSandbox {
  return new EvalSandbox(testCase, getToken, installationId);
}

export class EvalSandbox implements SandboxExecutor {
  private sandbox: Sandbox | null = null;
  private repoDir: string = '';
  private installationToken: string = '';
  private destroyed = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly startTime: number;

  constructor(
    private readonly testCase: EvalTestCase,
    private readonly getToken?: (installationId: number) => Promise<string>,
    private readonly installationId?: number,
  ) {
    this.startTime = Date.now();
  }

  private async getInstallationToken(): Promise<string> {
    if (this.getToken && this.installationId) {
      return this.getToken(this.installationId);
    }
    return '';
  }

  async boot(onProgress?: (phase: string, progress: number, message?: string) => void): Promise<void> {
    log.info({ testCase: this.testCase.id }, 'Booting eval sandbox');

    const totalTimeout = this.testCase.timeoutMs + 30000;
    const envs = sanitizeEnvironment({
      SYNTARO_EVAL_MODE: 'true',
      SYNTARO_REPO_URL: this.testCase.repo,
      ...(this.testCase.runCommand ? { SYNTARO_RUN_COMMAND: this.testCase.runCommand } : {}),
      ...(this.testCase.installCommand ? { SYNTARO_INSTALL_COMMAND: this.testCase.installCommand } : {}),
    });

    const templateId = config.e2b.evalTemplateId || 'syntaro-eval-hardened';

    try {
      this.sandbox = await Sandbox.create(templateId, {
        apiKey: config.e2b.apiKey,
        timeoutMs: totalTimeout,
        metadata: {
          evalRunId: this.testCase.id,
          testCase: this.testCase.title,
          repo: this.testCase.repo,
          startedAt: new Date(this.startTime).toISOString(),
        },
        envs,
      });
    } catch (err) {
      throw new EvalSandboxError('Failed to create eval sandbox', err);
    }

    log.info({ sandboxId: this.sandbox.sandboxId }, 'Eval sandbox created');

    if (this.getToken && this.installationId) {
      try {
        this.installationToken = await this.getInstallationToken();
      } catch (err) {
        await this.destroy();
        throw new EvalSandboxError('Failed to get installation token', err);
      }
    }

    this.repoDir = `/home/user/${this.testCase.repo.split('/').pop()?.replace('.git', '') || 'repo'}`;

    try {
      if (this.installationToken) {
        const authUrl = this.testCase.repo.replace(
          'https://',
          `https://x-access-token:${this.installationToken}@`,
        );
        await this.exec(`git clone --depth 1 ${authUrl} ${this.repoDir}`, 120000);
      } else {
        await this.exec(`git clone --depth 1 ${this.testCase.repo} ${this.repoDir}`, 120000);
      }
    } catch (err) {
      await this.destroy();
      throw new EvalSandboxError('Failed to clone repository', err);
    }

    onProgress?.('boot', 50, 'Repo cloned, installing dependencies');

    if (this.testCase.installCommand) {
      try {
        await this.exec(this.testCase.installCommand, 180000);
      } catch (err) {
        log.warn({ err }, 'Dependency install had issues (non-fatal)');
      }
    }

    onProgress?.('boot', 100, 'Eval sandbox ready');
  }

  async exec(command: string, timeoutMs: number = 60000): Promise<ExecResult> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    if (this.destroyed) throw new EvalSandboxError('Sandbox already destroyed');

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

  async execForTools(command: string, timeoutMs: number = 60000): Promise<ExecResult> {
    return this.exec(command, timeoutMs);
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    if (this.destroyed) throw new EvalSandboxError('Sandbox already destroyed');

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      return await this.sandbox.files.read(fullPath);
    } catch (err) {
      throw new EvalSandboxError(`Failed to read file ${filePath}`, err);
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    if (this.destroyed) throw new EvalSandboxError('Sandbox already destroyed');

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      const parentDir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : '.';
      await this.sandbox.files.makeDir(parentDir);
      await this.sandbox.files.write(fullPath, content);
    } catch (err) {
      throw new EvalSandboxError(`Failed to write file ${filePath}`, err);
    }
  }

  async removeFile(filePath: string): Promise<void> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    if (this.destroyed) throw new EvalSandboxError('Sandbox already destroyed');

    const fullPath = filePath.startsWith('/') ? filePath : `${this.repoDir}/${filePath}`;
    try {
      await this.sandbox.files.remove(fullPath);
    } catch (err) {
      throw new EvalSandboxError(`Failed to remove file ${filePath}`, err);
    }
  }

  hasTestSuite(): boolean {
    return true;
  }

  async runSpecificTest(testPath: string): Promise<import('../../src/sandbox/types.js').TestRunResult> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    const start = Date.now();
    const result = await this.exec(`${this.testCase.runCommand || 'npm test'} -- ${testPath} 2>&1`, 300000);
    return {
      passed: result.exitCode === 0,
      output: `${result.stdout}\n${result.stderr}`.trim(),
      command: `${this.testCase.runCommand || 'npm test'} -- ${testPath}`,
      durationMs: Date.now() - start,
    };
  }

  async runTests(): Promise<import('../../src/sandbox/types.js').TestRunResult> {
    if (!this.sandbox) throw new EvalSandboxError('Sandbox not booted');
    const command = this.testCase.runCommand || 'npm test 2>&1';
    const start = Date.now();
    const result = await this.exec(command, 300000);
    return {
      passed: result.exitCode === 0,
      output: `${result.stdout}\n${result.stderr}`.trim(),
      command,
      durationMs: Date.now() - start,
    };
  }

  async formatCode(): Promise<void> {
  }

  async analyzeCode(): Promise<string> {
    return '';
  }

  async detectRuntime(): Promise<import('../../src/sandbox/types.js').RuntimeInfo> {
    return {
      language: 'node',
      version: '',
      testCommand: this.testCase.runCommand || 'npm test',
      installCommand: this.testCase.installCommand || '',
      formatCommand: '',
      lintCommand: '',
    };
  }

  async installDeps(): Promise<void> {
    if (this.testCase.installCommand) {
      await this.exec(this.testCase.installCommand, 180000);
    }
  }

  async pushBranch(_branchName: string): Promise<void> {
    throw new EvalSandboxError('pushBranch is not supported in eval sandbox');
  }

  async destroy(): Promise<void> {
    this.destroyed = true;

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    if (this.sandbox) {
      const sid = this.sandbox.sandboxId;
      log.info({ sandboxId: sid }, 'Destroying eval sandbox');
      try {
        await this.sandbox.kill();
      } catch (err) {
        log.warn({ err: String(err) }, 'Error killing eval sandbox (non-fatal)');
      }
      this.sandbox = null;
    }
  }

  async runEval(onProgress?: (phase: string, progress: number, message?: string) => void): Promise<EvalResult> {
    try {
      await this.boot(onProgress);

      const durationMs = Date.now() - this.startTime;
      const remainingMs = this.testCase.timeoutMs - durationMs;

      if (remainingMs <= 0) {
        throw new EvalTimeoutError(`Agent exceeded ${this.testCase.timeoutMs}ms`);
      }

      this.timeoutHandle = setTimeout(async () => {
        if (this.sandbox) {
          log.warn({ sandboxId: this.sandbox.sandboxId }, 'Eval sandbox timeout reached, killing');
          await this.sandbox.kill();
        }
      }, remainingMs);

      const testResult = await this.runTests();
      return {
        passed: testResult.passed,
        output: testResult.output,
        durationMs: Date.now() - this.startTime,
        sandboxId: this.sandbox?.sandboxId || 'unknown',
      };
    } finally {
      if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
        this.timeoutHandle = null;
      }
      await this.destroy();
    }
  }
}
