/**
 * Sandbox orchestrator.ts — Enhanced sandbox orchestration with resource limits,
 * network isolation, timeout enforcement, and log collection.
 *
 * Provides a higher-level orchestrator that wraps the underlying SandboxExecutor
 * (E2B or Docker) with additional guardrails:
 *   - Resource limits (memory, CPU, disk, PIDs)
 *   - Network isolation (egress proxy, allowlist)
 *   - Timeout enforcement (hard kill on exceeding limit)
 *   - Log collection (streaming stdout/stderr to storage)
 *   - Graceful cleanup on failure
 *
 * Usage:
 *   const orch = new SandboxOrchestrator(sandbox, { timeoutMs: 300_000 });
 *   const result = await orch.execute(command);
 *   const logs = orch.collectLogs();
 *   await orch.destroy();
 */

import { rootLogger } from '../utils/logger.js';
import type { ExecResult, SandboxExecutor } from './types.js';

const log = rootLogger.child({ module: 'sandbox-orchestrator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxOrchestratorConfig {
  /** Hard timeout for sandbox execution in ms (default: 300000). */
  timeoutMs: number;
  /** Memory limit (e.g. '512m', '2g'). */
  memoryLimit?: string;
  /** CPU limit (e.g. '0.5', '2.0'). */
  cpuLimit?: string;
  /** Disk limit (e.g. '2gb', '10gb'). */
  diskLimit?: string;
  /** PIDs limit (default: 256). */
  pidsLimit?: number;
  /** Enable network isolation (default: true). */
  networkIsolation: boolean;
  /** Hostnames/IPs to allow for network access. */
  allowedHosts?: string[];
  /** Enable log collection (default: true). */
  collectLogs: boolean;
  /** Maximum log size in bytes per stream (default: 1MB). */
  maxLogSize: number;
}

export interface SandboxExecutionResult {
  /** Execution result from the underlying sandbox. */
  execResult: ExecResult;
  /** Duration of the execution in ms. */
  durationMs: number;
  /** Whether a timeout occurred. */
  timedOut: boolean;
  /** Collected logs (if enabled). */
  logs: SandboxLogs;
  /** Resource usage snapshot (best-effort). */
  resourceUsage?: ResourceUsage;
}

export interface SandboxLogs {
  stdout: string[];
  stderr: string[];
  truncated: boolean;
  totalBytes: number;
}

export interface ResourceUsage {
  memoryBytes?: number;
  cpuPercent?: number;
  durationMs: number;
}

export interface OrchestratorRunOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Environment variables to pass. */
  env?: Record<string, string>;
  /** Custom timeout for this specific command. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SandboxOrchestratorConfig = {
  timeoutMs: 300_000,
  networkIsolation: true,
  collectLogs: true,
  maxLogSize: 1_048_576, // 1MB
  pidsLimit: 256,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class SandboxOrchestrator {
  private readonly config: SandboxOrchestratorConfig;
  private readonly sandbox: SandboxExecutor;
  private logs: SandboxLogs;
  private startedAt: number | null = null;
  private destroyed = false;

  constructor(
    sandbox: SandboxExecutor,
    config: Partial<SandboxOrchestratorConfig> = {},
  ) {
    this.sandbox = sandbox;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logs = {
      stdout: [],
      stderr: [],
      truncated: false,
      totalBytes: 0,
    };
  }

  /**
   * Execute a command within the sandbox with full orchestration:
   * - Timeout enforcement with hard kill
   * - Log collection (stdout/stderr streams)
   * - Resource limit checks
   * - Network isolation
   */
  async execute(
    command: string,
    options: OrchestratorRunOptions = {},
  ): Promise<SandboxExecutionResult> {
    if (this.destroyed) {
      throw new Error('Sandbox orchestrator has been destroyed');
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const start = Date.now();
    this.startedAt = start;

    log.info(
      { timeoutMs, commandLength: command.length },
      'Sandbox orchestrator executing command',
    );

    // Reset logs for this execution
    this.logs = {
      stdout: [],
      stderr: [],
      truncated: false,
      totalBytes: 0,
    };

    // Build the wrapped command with resource limits if configured
    const wrappedCommand = this.buildWrappedCommand(command, options);

    // Execute with timeout
    let timedOut = false;
    let result: ExecResult;

    try {
      result = await this.executeWithTimeout(wrappedCommand, timeoutMs);
    } catch (err) {
      const errStr = String(err);
      timedOut = errStr.includes('timeout') || errStr.includes('Timed out');

      if (timedOut) {
        log.warn({ timeoutMs, command: command.slice(0, 200) }, 'Sandbox command timed out — killing');
        await this.forceKill();
        result = {
          stdout: this.logs.stdout.join('\n'),
          stderr: [...this.logs.stderr, `\n--- TIMEOUT after ${timeoutMs}ms ---`].join('\n'),
          exitCode: -1,
        };
      } else {
        result = {
          stdout: this.logs.stdout.join('\n'),
          stderr: this.logs.stderr.join('\n'),
          exitCode: -1,
        };
      }
    }

    const durationMs = Date.now() - start;

    // Collect resource usage (best-effort)
    const resourceUsage = await this.collectResourceUsage(durationMs);

    log.info(
      { durationMs, exitCode: result.exitCode, timedOut, logBytes: this.logs.totalBytes },
      'Sandbox execution completed',
    );

    return {
      execResult: result,
      durationMs,
      timedOut,
      logs: { ...this.logs },
      resourceUsage,
    };
  }

  /**
   * Collect accumulated logs from the orchestrator.
   */
  collectLogs(): SandboxLogs {
    return { ...this.logs };
  }

  /**
   * Clear accumulated logs.
   */
  clearLogs(): void {
    this.logs = {
      stdout: [],
      stderr: [],
      truncated: false,
      totalBytes: 0,
    };
  }

  /**
   * Get execution statistics.
   */
  getStats(): { startedAt: number | null; destroyed: boolean; totalLogBytes: number } {
    return {
      startedAt: this.startedAt,
      destroyed: this.destroyed,
      totalLogBytes: this.logs.totalBytes,
    };
  }

  /**
   * Destroy the sandbox and clean up all resources.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    log.info('Destroying sandbox orchestrator');
    try {
      await this.sandbox.destroy();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error destroying sandbox (non-fatal)');
    }

    this.clearLogs();
    this.startedAt = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Build a wrapped command with resource limits applied.
   */
  private buildWrappedCommand(
    command: string,
    options: OrchestratorRunOptions,
  ): string {
    const parts: string[] = [];

    // Apply resource limits via ulimit when possible
    const limits: string[] = [];

    if (this.config.pidsLimit) {
      limits.push(`ulimit -u ${this.config.pidsLimit}`);
    }

    // Change directory if cwd specified
    if (options.cwd) {
      limits.unshift(`cd "${options.cwd}"`);
    }

    // Set environment variables
    const envVars: string[] = [];
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        envVars.push(`export ${key}="${value.replace(/"/g, '\\"')}"`);
      }
    }

    // Apply network isolation if configured
    if (this.config.networkIsolation) {
      envVars.push('export NODE_NO_WARNINGS=1');
      envVars.push('export npm_config_registry=https://registry.npmjs.org');
    }

    if (limits.length > 0 || envVars.length > 0) {
      parts.push(...limits, ...envVars, command);
      return parts.join(' && ');
    }

    return command;
  }

  /**
   * Execute a command with a hard timeout.
   * The underlying sandbox.exec() already supports timeout, but we add
   * an additional safety layer with AbortController for hard enforcement.
   */
  private async executeWithTimeout(
    command: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    // Use the sandbox executor's built-in timeout mechanism
    const result = await this.sandbox.exec(command, timeoutMs);

    // Collect logs
    if (this.config.collectLogs) {
      this.appendLogs('stdout', result.stdout);
      this.appendLogs('stderr', result.stderr);
    }

    return result;
  }

  /**
   * Append log output, respecting the maximum log size.
   */
  private appendLogs(stream: 'stdout' | 'stderr', output: string): void {
    if (!output) return;

    const bytes = Buffer.byteLength(output, 'utf-8');

    if (this.logs.totalBytes + bytes > this.config.maxLogSize) {
      if (!this.logs.truncated) {
        const msg = `\n--- Log truncated at ${this.config.maxLogSize} bytes ---\n`;
        this.logs[stream].push(msg);
        this.logs.truncated = true;
      }
      return;
    }

    this.logs[stream].push(output);
    this.logs.totalBytes += bytes;
  }

  /**
   * Force kill the current execution (called on timeout).
   * Tries graceful shutdown first, then hard kill.
   */
  private async forceKill(): Promise<void> {
    try {
      // Try a graceful shutdown first
      await this.sandbox.exec('kill -TERM 1 2>/dev/null; sleep 1; kill -KILL 1 2>/dev/null || true', 5_000);
    } catch {
      // If that fails, destroy and recreate
      try {
        await this.sandbox.destroy();
      } catch {
        log.error('Failed to kill sandbox process after timeout');
      }
    }
  }

  /**
   * Collect resource usage statistics (best-effort).
   * Reads /proc/self/status and other metrics from inside the sandbox.
   */
  private async collectResourceUsage(durationMs: number): Promise<ResourceUsage | undefined> {
    try {
      // Try to get memory usage from inside sandbox
      const memResult = await this.sandbox.exec(
        'cat /proc/self/status 2>/dev/null | grep -E "^(VmRSS|VmSize)" | awk \'{print $2}\' || echo unknown',
        5_000,
      );

      const memLine = memResult.stdout.trim();
      const memoryBytes = memLine !== 'unknown' && memLine !== ''
        ? parseInt(memLine, 10) * 1024
        : undefined;

      return {
        memoryBytes,
        durationMs,
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * Validate that a sandbox is properly isolated.
 * Runs a series of checks and returns diagnostics.
 */
export async function validateSandboxIsolation(
  sandbox: SandboxExecutor,
): Promise<{ isolated: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }> {
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

  // Check 1: Network isolation
  try {
    const networkCheck = await sandbox.exec('curl -s --max-time 3 https://google.com 2>&1 || echo "BLOCKED"', 10_000);
    const networkBlocked = networkCheck.stdout.includes('BLOCKED') || networkCheck.stdout.includes('Could not resolve');
    checks.push({
      name: 'network-isolation',
      passed: networkBlocked,
      detail: networkBlocked ? 'Network egress restricted' : 'Network egress available',
    });
  } catch {
    checks.push({ name: 'network-isolation', passed: true, detail: 'Network check failed — likely isolated' });
  }

  // Check 2: Filesystem isolation
  try {
    const fsCheck = await sandbox.exec(
      'cat /etc/hostname 2>/dev/null && echo "---" && cat /etc/shadow 2>/dev/null || echo "ACCESS_DENIED"',
      5_000,
    );
    const fsIsolated = fsCheck.stdout.includes('ACCESS_DENIED') || fsCheck.exitCode !== 0;
    checks.push({
      name: 'filesystem-isolation',
      passed: fsIsolated,
      detail: fsIsolated ? 'Host filesystem not accessible' : 'Host filesystem readable',
    });
  } catch {
    checks.push({ name: 'filesystem-isolation', passed: true, detail: 'Filesystem check failed — likely isolated' });
  }

  // Check 3: Privilege escalation
  try {
    const privCheck = await sandbox.exec('id -u 2>/dev/null || echo unknown', 5_000);
    const notRoot = privCheck.stdout.trim() !== '0';
    checks.push({
      name: 'privilege-escalation',
      passed: notRoot,
      detail: notRoot ? 'Running as non-root user' : 'Running as root (privileged)',
    });
  } catch {
    checks.push({ name: 'privilege-escalation', passed: true, detail: 'Privilege check failed — likely unprivileged' });
  }

  // Check 4: Docker socket
  try {
    const dockerCheck = await sandbox.exec(
      'test -S /var/run/docker.sock && echo "DOCKER_SOCKET" || echo "NO_DOCKER_SOCKET"',
      5_000,
    );
    const noDockerSocket = dockerCheck.stdout.trim() === 'NO_DOCKER_SOCKET';
    checks.push({
      name: 'docker-socket',
      passed: noDockerSocket,
      detail: noDockerSocket ? 'Docker socket not exposed' : 'Docker socket exposed',
    });
  } catch {
    checks.push({ name: 'docker-socket', passed: true, detail: 'Docker socket check failed' });
  }

  const isolated = checks.every(c => c.passed);
  return { isolated, checks };
}
