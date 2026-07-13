import { rootLogger } from '../utils/logger.js';
import {
  DEFAULT_PIPELINE_CONFIG,
  type PipelineConfigRun,
  type PipelineParams,
} from './types.js';

const log = rootLogger.child({ module: 'pipeline-config-resolver' });

// ---------------------------------------------------------------------------
// In-memory pipeline version store
// ---------------------------------------------------------------------------

/** Maps pipelineId -> array of PipelineConfigRun ordered by version. */
const versionStore = new Map<string, PipelineConfigRun[]>();

function nextVersion(pipelineId: string): number {
  const chain = versionStore.get(pipelineId);
  if (!chain || chain.length === 0) return 1;
  return chain[chain.length - 1].version + 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse `key=value` pairs from an issue body.
 * Supports one-per-line or comma-separated values:
 *
 *   batch_size=128
 *   learning_rate=0.0001
 *   feature_set=extended
 */
export function parseParamsFromBody(body: string | null | undefined): Partial<PipelineParams> {
  const overrides: Partial<PipelineParams> = {};
  if (!body) return overrides;

  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // Support `key=value` and `key: value` formats
    const match = trimmed.match(/^(\w+)\s*[=:]\s*(.+)$/);
    if (!match) continue;

    const key = match[1] as keyof PipelineParams;
    const raw = match[2].trim();

    // Type-coerce numbers
    if (key === 'learning_rate' || key === 'batch_size') {
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        log.warn({ key, raw }, 'Ignoring non-numeric pipeline param value');
        continue;
      }
      overrides[key] = num;
    } else {
      overrides[key] = raw;
    }
  }

  return overrides;
}

/**
 * Resolve the final config for a pipeline run by merging defaults with
 * ticket-level overrides parsed from the issue body.
 */
export function resolveConfig(
  body: string | null | undefined,
): PipelineParams {
  const overrides = parseParamsFromBody(body);
  const merged: PipelineParams = { ...DEFAULT_PIPELINE_CONFIG, ...overrides };
  log.info({ overrides, merged }, 'Pipeline config resolved');
  return merged;
}

/**
 * Create a versioned pipeline run.
 *
 * If `pipelineId` already has runs, the new run is versioned from the latest
 * (parentVersion set automatically).  The first run gets version 1.
 */
export function createPipelineRun(
  pipelineId: string,
  configBlob: PipelineParams,
  ticketId?: string,
  datasetHash?: string,
): PipelineConfigRun {
  const version = nextVersion(pipelineId);
  const parentVersion = version > 1 ? version - 1 : undefined;

  const now = new Date().toISOString();
  const run: PipelineConfigRun = {
    id: `${pipelineId}:v${version}`,
    pipelineId,
    version,
    parentVersion,
    configBlob,
    datasetHash,
    ticketId,
    createdAt: now,
    updatedAt: now,
  };

  const chain = versionStore.get(pipelineId) ?? [];
  chain.push(run);
  versionStore.set(pipelineId, chain);

  log.info({ pipelineId, version, parentVersion }, 'Pipeline run created');
  return run;
}

/**
 * Update a pipeline run with metrics collected after execution.
 */
export function updatePipelineRunMetrics(
  pipelineId: string,
  version: number,
  metrics: Record<string, number>,
): PipelineConfigRun | undefined {
  const chain = versionStore.get(pipelineId);
  if (!chain) return undefined;

  const run = chain.find((r) => r.version === version);
  if (!run) return undefined;

  run.metrics = metrics;
  run.updatedAt = new Date().toISOString();
  return run;
}

/**
 * Retrieve a specific version of a pipeline run.
 */
export function getPipelineRun(
  pipelineId: string,
  version: number,
): PipelineConfigRun | undefined {
  return versionStore.get(pipelineId)?.find((r) => r.version === version);
}

/**
 * Return the full version chain for a pipeline, oldest first.
 */
export function getPipelineVersionChain(pipelineId: string): PipelineConfigRun[] {
  return [...(versionStore.get(pipelineId) ?? [])];
}

/**
 * Return the latest version of a pipeline run, or undefined if none exist.
 */
export function getLatestPipelineRun(pipelineId: string): PipelineConfigRun | undefined {
  const chain = versionStore.get(pipelineId);
  return chain && chain.length > 0 ? chain[chain.length - 1] : undefined;
}

/**
 * List all pipeline IDs that have at least one run.
 */
export function listPipelineIds(): string[] {
  return [...versionStore.keys()];
}

/**
 * Clear all stored runs (for testing).
 */
export function clearPipelineStore(): void {
  versionStore.clear();
}
