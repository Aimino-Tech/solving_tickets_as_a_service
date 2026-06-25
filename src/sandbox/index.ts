/**
 * Sandbox factory — auto-selects the best available sandbox implementation.
 *
 * Selection priority:
 *   1. E2B (if E2B_API_KEY is configured)
 *   2. Docker (if E2B fails AND E2B_FALLBACK_TO_DOCKER is true, or Docker is available)
 *   3. Throw error (no sandbox available)
 */

import { execSync } from 'node:child_process';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { E2BSandboxExecutor } from './executor.js';
import { DockerSandbox } from './docker.js';
import { validateE2bTemplate, classifyE2bError } from './validate.js';
import { bridgeMetrics } from '../bridge/metrics.js';
import type {
  SandboxExecutor,
  ExecResult,
  TestRunResult,
  RuntimeInfo,
} from './types.js';

const log = rootLogger.child({ module: 'sandbox-factory' });

export type { SandboxExecutor, ExecResult, TestRunResult, RuntimeInfo };
export type { PoolConfig } from './pool.js';
export { SandboxPool } from './pool.js';
export { SandboxGC } from './gc.js';
export { validateE2bTemplate, classifyE2bError } from './validate.js';

function isDockerAvailable(): boolean {
  try {
    const output = execSync('docker --version', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Create the most appropriate sandbox implementation.
 *
 * Selection logic:
 *   1. If E2B_API_KEY is configured, try E2B first.
 *   2. If E2B is configured but fails, AND fallbackToDocker is enabled,
 *      fall through to Docker (if available).
 *   3. If E2B is not configured, try Docker directly.
 *   4. If neither is available, throw.
 *
 * @param repoUrl - Git remote URL for the repo to clone
 * @param repoOwner - Repository owner (user or org)
 * @param repoName - Repository name
 * @param installationId - GitHub App installation ID
 * @param getToken - Async callback to get an installation access token
 * @returns A SandboxExecutor instance ready to boot
 * @throws If no sandbox implementation is available
 */
export function createSandbox(
  repoUrl: string,
  repoOwner: string,
  repoName: string,
  installationId: number,
  getToken: (installationId: number) => Promise<string>,
): SandboxExecutor {
  // Priority 1: E2B if API key is configured
  if (config.e2b.apiKey) {
    log.info('E2B API key found — creating E2BSandboxExecutor');
    // We return an E2B sandbox; if boot() fails later, the caller can handle it.
    // The fallback to Docker happens at the factory level when E2B is not configured,
    // or at runtime when boot() fails AND fallbackToDocker is enabled (handled by caller).
    return new E2BSandboxExecutor(
      repoUrl, repoOwner, repoName, installationId, getToken,
      config.e2b.fallbackToDocker, // Pass fallback flag so executor knows to try Docker
    );
  }

  // Priority 2: Docker if available
  if (isDockerAvailable()) {
    log.info('Docker is available — creating DockerSandbox');
    return new DockerSandbox(repoUrl, repoOwner, repoName, installationId, getToken);
  }

  // No sandbox available
  throw new Error(
    'No sandbox implementation available. Configure E2B_API_KEY or ensure Docker is running.',
  );
}

/**
 * Create a sandbox with automatic fallback.
 *
 * Unlike createSandbox(), this function tries E2B first and automatically
 * falls back to Docker if E2B fails and fallback is enabled.
 *
 * @returns A booted SandboxExecutor instance
 */
export async function createSandboxWithFallback(
  repoUrl: string,
  repoOwner: string,
  repoName: string,
  installationId: number,
  getToken: (installationId: number) => Promise<string>,
  onProgress?: (phase: string, progress: number, message?: string) => void,
): Promise<SandboxExecutor> {
  // Try E2B first if configured
  if (config.e2b.apiKey) {
    const e2bExecutor = new E2BSandboxExecutor(
      repoUrl, repoOwner, repoName, installationId, getToken,
      config.e2b.fallbackToDocker,
    );
    try {
      await e2bExecutor.boot(onProgress);
      log.info('E2B sandbox booted successfully');
      return e2bExecutor;
    } catch (err) {
      const errorMsg = String(err);
      const errorType = classifyE2bError(errorMsg);
      log.warn({ error: errorMsg, errorType }, 'E2B sandbox boot failed');

      // Track E2B failure
      bridgeMetrics.incrementCounter('stas_sandbox_errors_total', {
        repo: `${repoOwner}/${repoName}`,
        error: `e2b_${errorType}`,
      });
      trackE2BFailure(repoOwner, repoName, errorType);

      // Fall back to Docker if enabled
      if (config.e2b.fallbackToDocker && isDockerAvailable()) {
        log.info('Falling back to Docker sandbox');
        bridgeMetrics.incrementCounter('stas_e2b_fallback_to_docker_total', {
          repo: `${repoOwner}/${repoName}`,
          reason: errorType,
        });
        const dockerSandbox = new DockerSandbox(repoUrl, repoOwner, repoName, installationId, getToken);
        await dockerSandbox.boot(onProgress);
        return dockerSandbox;
      }

      // Re-throw if no fallback
      throw err;
    }
  }

  // No E2B configured — try Docker
  if (isDockerAvailable()) {
    const dockerSandbox = new DockerSandbox(repoUrl, repoOwner, repoName, installationId, getToken);
    await dockerSandbox.boot(onProgress);
    return dockerSandbox;
  }

  throw new Error(
    'No sandbox implementation available. Configure E2B_API_KEY or ensure Docker is running.',
  );
}

/**
 * Track E2B failure in Prometheus metrics.
 */
function trackE2BFailure(repoOwner: string, repoName: string, errorType: string): void {
  bridgeMetrics.incrementCounter('stas_e2b_failures_total', {
    repo: `${repoOwner}/${repoName}`,
    error: errorType,
  });
  bridgeMetrics.incrementCounter('stas_sandbox_errors_total', {
    repo: `${repoOwner}/${repoName}`,
    error: `e2b_${errorType}`,
  });
}
