/**
 * Sandbox security configuration and utilities.
 *
 * Provides defaults and validation for sandbox execution security:
 * - Privilege mode (no --privileged)
 * - Read-only root filesystem
 * - Network access controls
 * - Resource limits (CPU, memory, disk)
 *
 * These settings are enforced at the Docker/container level when running
 * the sandbox locally, and at the E2B sandbox level for cloud execution.
 *
 * Usage:
 *   ```ts
 *   import { SANDBOX_SECURITY, validateSandboxConfig } from './security/sandboxSecurity.js';
 *   ```
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'sandbox-security' });

/**
 * Default sandbox security configuration.
 *
 * These are safe defaults that prevent privilege escalation, limit
 * resource consumption, and restrict network access.
 */
export const SANDBOX_SECURITY = {
  /** Never run containers with --privileged flag */
  privileged: false,
  /** Make root filesystem read-only (tmpfs for writable locations) */
  readOnlyRootFS: true,
  /** Drop all capabilities (Docker) */
  dropCapabilities: ['ALL'],
  /** Only add back capabilities that are strictly necessary */
  addCapabilities: [] as string[],
  /** Default resource limits */
  resources: {
    cpu: {
      /** CPU shares (relative weight). 1024 = default, lower = less priority */
      shares: 512,
      /** CPU quota in microseconds (e.g., 50000 = 0.5 CPU) */
      quota: 50000,
      /** CPU period in microseconds */
      period: 100000,
      /** CPU set (e.g., '0-1' for first two cores) */
      cpuset: '0',
    },
    memory: {
      /** Maximum memory in bytes (512 MB) */
      limit: 512 * 1024 * 1024,
      /** Soft memory limit */
      reservation: 256 * 1024 * 1024,
      /** Disable swap */
      swap: 0,
    },
    disk: {
      /** Maximum disk space in bytes (2 GB) */
      size: 2 * 1024 * 1024 * 1024,
    },
    pids: {
      /** Maximum number of processes (prevent fork bombs) */
      limit: 256,
    },
  },
  /** Network policy */
  network: {
    /** Prevent sandbox from accessing internal Docker networks */
    internalNetworks: false,
    /** Allow outbound internet access (needed for npm/pip installs) */
    outboundInternet: true,
    /** Explicitly deny access to internal service IP ranges */
    deniedRanges: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
      '::1/128',
    ],
  },
} as const;

/**
 * Validate that a sandbox configuration does not use privileged mode
 * and has reasonable resource limits.
 *
 * @param sandboxConfig - Partial sandbox configuration to validate
 * @throws {Error} If the configuration violates security policies
 */
export function validateSandboxConfig(sandboxConfig: Record<string, unknown>): void {
  if (sandboxConfig.privileged === true) {
    log.error('Sandbox configured with --privileged mode — this is a security violation');
    throw new Error('Sandbox privilege mode violation: --privileged is not allowed');
  }

  if (sandboxConfig.readOnlyRootFS === false) {
    log.warn('Sandbox configured with writable root filesystem — recommend read-only for production');
  }

  // Validate memory limits
  if (typeof sandboxConfig.memoryLimit === 'number' && sandboxConfig.memoryLimit > 2 * 1024 * 1024 * 1024) {
    log.warn({ memoryLimit: sandboxConfig.memoryLimit }, 'Sandbox memory limit exceeds 2 GB');
  }

  log.info({ sandboxConfig }, 'Sandbox security configuration validated');
}

/**
 * Docker run options for sandbox security.
 * Use these when spawning Docker containers for local sandbox execution.
 *
 * Example:
 *   docker run \\
 *     ${SANDBOX_DOCKER_OPTS.join(' \\\n    ')} \\
 *     my-sandbox-image
 */
export const SANDBOX_DOCKER_OPTS: string[] = [
  '--read-only',
  '--security-opt=no-new-privileges:true',
  '--cap-drop=ALL',
  '--memory=512m',
  '--memory-reservation=256m',
  '--memory-swap=0',
  '--cpus=0.5',
  '--pids-limit=256',
  '--network=none',
];

/**
 * Get Docker security options as a joined string (for dockerode or similar).
 */
export function getDockerSecurityOpts(additionalOpts: string[] = []): string[] {
  return [...SANDBOX_DOCKER_OPTS, ...additionalOpts];
}
