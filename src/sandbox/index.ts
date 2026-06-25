/**
 * Sandbox factory — auto-selects the best available sandbox implementation.
 *
 * Selection priority:
 *   1. E2B (if E2B_API_KEY is configured)
 *   2. Docker (if Docker is available on the host)
 *   3. Throw error (no sandbox available)
 */

import { execSync } from 'node:child_process';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { E2BSandboxExecutor } from './executor.js';
import { DockerSandbox } from './docker.js';
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
    return new E2BSandboxExecutor(repoUrl, repoOwner, repoName, installationId, getToken);
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
