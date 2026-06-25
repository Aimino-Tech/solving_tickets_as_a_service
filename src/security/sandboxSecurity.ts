import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'sandbox-security' });

export const SANDBOX_SECURITY = {
  privileged: false,
  readOnlyRootFS: true,
  dropCapabilities: ['ALL'],
  addCapabilities: [] as string[],
  resources: {
    cpu: {
      shares: 512,
      quota: 50000,
      period: 100000,
      cpuset: '0',
    },
    memory: {
      limit: 512 * 1024 * 1024,
      reservation: 256 * 1024 * 1024,
      swap: 0,
    },
    disk: {
      size: 2 * 1024 * 1024 * 1024,
    },
    pids: {
      limit: 256,
    },
  },
  network: {
    internalNetworks: false,
    outboundInternet: true,
    deniedRanges: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
      '::1/128',
    ],
  },
} as const;

export function validateSandboxConfig(sandboxConfig: Record<string, unknown>): void {
  if (sandboxConfig.privileged === true) {
    log.error('Sandbox configured with --privileged mode — this is a security violation');
    throw new Error('Sandbox privilege mode violation: --privileged is not allowed');
  }

  if (sandboxConfig.readOnlyRootFS === false) {
    log.warn('Sandbox configured with writable root filesystem — recommend read-only for production');
  }

  if (typeof sandboxConfig.memoryLimit === 'number' && sandboxConfig.memoryLimit > 2 * 1024 * 1024 * 1024) {
    log.warn({ memoryLimit: sandboxConfig.memoryLimit }, 'Sandbox memory limit exceeds 2 GB');
  }

  log.info({ sandboxConfig }, 'Sandbox security configuration validated');
}

export const SANDBOX_DOCKER_OPTS: string[] = [
  '--read-only',
  '--security-opt=no-new-privileges:true',
  '--cap-drop=ALL',
  '--cap-add=NET_ADMIN',
  '--cap-add=NET_RAW',
  '--cap-add=DAC_OVERRIDE',
  '--cap-add=CHOWN',
  '--cap-add=FOWNER',
  '--cap-add=FSETID',
  '--cap-add=SETGID',
  '--cap-add=SETUID',
  '--memory=512m',
  '--memory-reservation=256m',
  '--memory-swap=0',
  '--cpus=0.5',
  '--pids-limit=256',
  '--network=none',
  `--security-opt=seccomp=${config.docker.seccompProfile}`,
  `--security-opt=apparmor=${config.docker.apparmorProfile}`,
];

export function getDockerSecurityOpts(additionalOpts: string[] = []): string[] {
  return [...SANDBOX_DOCKER_OPTS, ...additionalOpts];
}
