import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { DockerSandbox, dockerCmd } from './docker.js';

const log = rootLogger.child({ module: 'sandbox-pool' });

const CONTAINER_WORKDIR = '/home/user';

export interface PoolConfig {
  maxIdle: number;
  maxTotal: number;
  ttlMs: number;
}

interface WarmContainer {
  id: string;
  name: string;
  tempDir: string;
}

export class SandboxPool {
  private warm: WarmContainer[] = [];
  private activeCount = 0;
  private warmingUp = false;

  constructor(
    private cfg: PoolConfig,
  ) {
    this.warmUp();
  }

  private async warmUp(): Promise<void> {
    if (this.warmingUp) return;
    this.warmingUp = true;
    try {
      await this.ensureImage();
      while (this.warm.length < this.cfg.maxIdle) {
        const wc = await this.createContainer();
        this.warm.push(wc);
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Pool warm-up failed — containers will be created on demand');
    } finally {
      this.warmingUp = false;
    }
  }

  private async ensureImage(): Promise<void> {
    const image = config.docker.image;
    log.info({ image }, 'Pulling Docker image for pool');
    const pullResult = dockerCmd(['pull', image], 300_000);
    if (pullResult.exitCode !== 0) {
      throw new Error(`Failed to pull Docker image '${image}': ${pullResult.stderr}`);
    }
    log.info({ image }, 'Image pulled for pool');
  }

  private async createContainer(): Promise<WarmContainer> {
    const image = config.docker.image;
    const tempDir = mkdtempSync(join(tmpdir(), 'stas-sandbox-pool-'));
    const containerName = `stas-sandbox-pool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const args: string[] = [
      'create', '--init', '--rm',
      '--name', containerName,
      '-v', `${tempDir}:${CONTAINER_WORKDIR}`,
      '-w', CONTAINER_WORKDIR,
    ];

    const memory = config.docker.containerMemory;
    if (memory) args.push('--memory', memory);

    const cpu = config.docker.containerCpu;
    if (cpu) args.push('--cpus', String(cpu));

    args.push('--label', 'stas-sandbox=true');

    // ── Security hardening ────────────────────────────────────────────

    // Seccomp profile (if configured)
    if (config.docker.seccompProfile) {
      args.push('--security-opt', `seccomp=${config.docker.seccompProfile}`);
    }

    // AppArmor profile (if configured)
    if (config.docker.apparmorProfile) {
      args.push('--security-opt', `apparmor=${config.docker.apparmorProfile}`);
    }

    // No new privileges
    args.push('--security-opt', 'no-new-privileges:true');

    // Drop all capabilities (only add NET_ADMIN/NET_RAW if needed)
    if (config.docker.dropAllCapabilities) {
      args.push('--cap-drop', 'ALL');
      // Only add network capabilities if network is enabled
      if (!config.docker.networkDisabled) {
        args.push('--cap-add', 'NET_ADMIN');
        args.push('--cap-add', 'NET_RAW');
      }
    }

    // Read-only root filesystem with writable /tmp
    if (config.docker.readonlyRootfs) {
      args.push('--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=2g');
    }

    // Runtime (runc or runsc/gVisor)
    const runtime = config.docker.runtime;
    if (runtime && runtime !== 'runc') {
      args.push('--runtime', runtime);
    } else {
      // Explicitly set runc for consistency
      args.push('--runtime', 'runc');
    }

    // Network
    if (config.docker.networkRestrict) {
      args.push('--network', 'stas_agent-net');
    } else {
      args.push('--network', 'none');
    }

    args.push('-e', `HOME=${CONTAINER_WORKDIR}`);
    args.push('-e', 'USER=node');
    args.push(image);
    args.push('tail', '-f', '/dev/null');

    const createResult = dockerCmd(args);
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create warm container: ${createResult.stderr}`);
    }

    const containerId = createResult.stdout;
    const startResult = dockerCmd(['start', containerId]);
    if (startResult.exitCode !== 0) {
      throw new Error(`Failed to start warm container: ${startResult.stderr}`);
    }

    log.info({ containerId, containerName }, 'Warm container created');
    return { id: containerId, name: containerName, tempDir };
  }

  async acquire(
    repoUrl: string,
    repoOwner: string,
    repoName: string,
    installationId: number,
    getToken: (installationId: number) => Promise<string>,
  ): Promise<DockerSandbox> {
    if (this.activeCount >= this.cfg.maxTotal) {
      throw new Error(`All sandboxes in use (${this.cfg.maxTotal})`);
    }

    let wc: WarmContainer;
    if (this.warm.length > 0) {
      wc = this.warm.pop()!;
      log.info({ containerId: wc.id }, 'Acquiring warm container');
    } else {
      log.info('No warm container available — creating fresh');
      wc = await this.createContainer();
    }

    const sandbox = new DockerSandbox(repoUrl, repoOwner, repoName, installationId, getToken, { id: wc.id, name: wc.name }, wc.tempDir);
    await sandbox.boot();
    this.activeCount++;
    return sandbox;
  }

  async release(sandbox: DockerSandbox): Promise<void> {
    if (this.warm.length < this.cfg.maxIdle) {
      log.info('Recycling sandbox back to pool');
      const wc = sandbox.__poolExtract();
      await this.execCleanup(wc);
      this.warm.push(wc);
    } else {
      log.info('Pool is full — destroying sandbox');
      await sandbox.destroy();
    }
    this.activeCount--;
  }

  private async execCleanup(wc: WarmContainer): Promise<void> {
    dockerCmd(['exec', wc.id, '/bin/sh', '-c', `rm -rf ${CONTAINER_WORKDIR}/.* ${CONTAINER_WORKDIR}/* 2>/dev/null; pkill -P 1 2>/dev/null || true`]);
  }

  async destroy(): Promise<void> {
    log.info('Destroying sandbox pool');
    const errors: string[] = [];
    for (const wc of this.warm) {
      const stopResult = dockerCmd(['stop', '--time', '5', wc.id]);
      if (stopResult.exitCode !== 0) errors.push(`stop ${wc.id}: ${stopResult.stderr}`);
      const rmResult = dockerCmd(['rm', '--force', '--volumes', wc.id]);
      if (rmResult.exitCode !== 0) errors.push(`rm ${wc.id}: ${rmResult.stderr}`);
    }
    this.warm = [];
    this.activeCount = 0;
    if (errors.length > 0) {
      throw new Error(`Pool destroy had errors: ${errors.join('; ')}`);
    }
  }

  idleCount(): number {
    return this.warm.length;
  }

  activeCountValue(): number {
    return this.activeCount;
  }
}
