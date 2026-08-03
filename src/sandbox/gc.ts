import { rootLogger } from '../utils/logger.js';
import { dockerCmd } from './docker.js';

const log = rootLogger.child({ module: 'sandbox-gc' });

const STALE_AGE_MS = 60 * 60 * 1000;
const SANDBOX_LABEL = 'syntaro-sandbox=true';
const AGENT_NET = 'syntaro_agent-net';

export class SandboxGC {
  async sweep(): Promise<number> {
    log.info('Running sandbox GC sweep');

    const psResult = dockerCmd([
      'ps', '-a',
      '--filter', `label=${SANDBOX_LABEL}`,
      '--format', '{{.ID}}\t{{.CreatedAt}}\t{{.Names}}',
    ]);

    if (psResult.exitCode !== 0) {
      log.warn({ err: psResult.stderr }, 'Failed to list containers for GC');
      return 0;
    }

    const lines = psResult.stdout.trim().split('\n').filter(Boolean);
    const now = Date.now();
    let cleaned = 0;

    for (const line of lines) {
      const [id, createdAt, name] = line.split('\t');
      const ageMs = now - new Date(createdAt).getTime();

      if (Number.isNaN(ageMs)) {
        log.warn({ line }, 'Could not parse container creation time');
        continue;
      }

      if (ageMs >= STALE_AGE_MS) {
        log.info({ containerId: id, name, ageMs }, 'Destroying stale sandbox container');
        dockerCmd(['stop', '--time', '5', id]);
        dockerCmd(['rm', '--force', '--volumes', id]);
        cleaned++;
      }
    }

    await this.cleanNetworkIfEmpty();

    log.info({ cleaned }, 'GC sweep complete');
    return cleaned;
  }

  private async cleanNetworkIfEmpty(): Promise<void> {
    const netResult = dockerCmd([
      'network', 'inspect', AGENT_NET,
      '--format', '{{.Containers}}',
    ]);

    if (netResult.exitCode !== 0) {
      return;
    }

    const containers = netResult.stdout.trim();
    if (containers === 'map[]' || containers === '<no value>' || containers === '') {
      log.info({ network: AGENT_NET }, 'Network has no containers — removing');
      dockerCmd(['network', 'rm', AGENT_NET]);
    }
  }
}
