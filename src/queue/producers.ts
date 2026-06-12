/**
 * RabbitMQ producer functions for publishing fix and triage jobs.
 *
 * Provides publishFixJob and publishTriageJob with:
 * - Standard message envelope (AIM-1232 format)
 * - Deduplication via Redis SET with configurable TTL
 * - Retry count tracking in message headers
 * - Persistent message delivery
 * - Message TTL matching QUEUE_DEDUP_TTL_SECONDS
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Redis unavailability falls back to allowing publish (no false blocking)
 * ✅ RabbitMQ unavailability logs warning and returns false
 * ✅ All operations have try/catch with structured logging
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData, MessageEnvelope, TriageData } from '../utils/types.js';
import { connect, publish, isConnected } from './rabbitmq.js';
import type { PublishOptions } from './rabbitmq.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

const log = rootLogger.child({ module: 'producers' });

// ---------------------------------------------------------------------------
// Lazy Redis connection for deduplication
// ---------------------------------------------------------------------------

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis dedup connection retry in ${delay}ms`);
        return delay;
      },
      lazyConnect: true,
    });
  }
  return redis;
}

/**
 * Check if a message is a duplicate within the dedup window.
 *
 * Uses Redis SET NX with PX TTL. Returns true if the key already exists
 * (duplicate detected), false if the key was set (first time) or if Redis
 * is unavailable (allow publish to avoid false blocking).
 */
async function isDuplicate(dedupKey: string): Promise<boolean> {
  try {
    const r = getRedis();
    // SET NX returns 'OK' if key was set (first time), null if key already exists
    const result = await r.set(dedupKey, '1', 'PX', config.queue.dedupTtl * 1000, 'NX');
    return result !== 'OK';
  } catch (err) {
    log.warn({ err: String(err), dedupKey }, 'Redis dedup check failed — allowing publish');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

/**
 * Create a standard message envelope (AIM-1232 format).
 */
function createEnvelope(
  type: string,
  payload: unknown,
  correlationId?: string,
  replyTo?: string,
): MessageEnvelope {
  return {
    version: 1,
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: 'stas-bot',
    type,
    correlationId,
    replyTo,
    payload,
  };
}

/**
 * Build RabbitMQ publish options from producer options.
 */
function buildPublishOptions(
  options?: { retryCount?: number; correlationId?: string; replyTo?: string },
): PublishOptions {
  const headers: Record<string, string> = {};

  if (options?.retryCount !== undefined) {
    headers['x-retry-count'] = String(options.retryCount);
  }

  return {
    persistent: true,
    expiration: String(config.queue.dedupTtl * 1000),
    headers,
  };
}

/**
 * Ensure the RabbitMQ connection is established.
 * Returns true if connected, false if unavailable.
 */
async function ensureConnected(): Promise<boolean> {
  if (isConnected()) return true;
  try {
    await connect();
    return true;
  } catch (err) {
    log.warn({ err: String(err) }, 'RabbitMQ not available');
    return false;
  }
}

/**
 * Check the `rabbitmq_backend` feature flag.
 * When disabled, queue publishing is skipped and callers should handle
 * the job via BullMQ or in-process execution instead.
 */
async function isRabbitMqBackendEnabled(): Promise<boolean> {
  const enabled = await isFeatureEnabled('rabbitmq_backend');
  if (!enabled) {
    log.warn('RabbitMQ backend disabled by feature flag — queue jobs will not be published to RabbitMQ');
  }
  return enabled;
}

// ---------------------------------------------------------------------------
// Producer functions
// ---------------------------------------------------------------------------

/**
 * Publish a fix job to the stas.issues.fix queue.
 *
 * Deduplicates by issue identity within the configured TTL window.
 * Retry count is tracked in the x-retry-count message header.
 *
 * @param data - The issue job data describing the fix to perform.
 * @param options - Optional correlationId, replyTo, and retryCount.
 * @returns true if the message was published, false if deduplicated or failed.
 */
export async function publishFixJob(
  data: IssueJobData,
  options?: { correlationId?: string; replyTo?: string; retryCount?: number },
): Promise<boolean> {
  if (!(await isRabbitMqBackendEnabled())) return false;

  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = `fix:${data.installationId}:${repo}#${data.issueNumber}`;

  // Dedup check
  if (await isDuplicate(dedupKey)) {
    log.info(
      { repo, issueNumber: data.issueNumber, dedupKey },
      'Fix job is a duplicate — skipping',
    );
    return false;
  }

  // Ensure RabbitMQ connection
  if (!(await ensureConnected())) {
    log.warn({ repo, issueNumber: data.issueNumber }, 'RabbitMQ unavailable — fix job not published');
    return false;
  }

  const envelope = createEnvelope('fix', data, options?.correlationId, options?.replyTo);
  const publishOptions = buildPublishOptions(options);

  const published = await publish('stas.issues', 'fix', envelope, publishOptions);

  if (published) {
    log.info(
      { repo, issueNumber: data.issueNumber, messageId: envelope.messageId },
      'Fix job published to RabbitMQ',
    );
  } else {
    log.warn(
      { repo, issueNumber: data.issueNumber, messageId: envelope.messageId },
      'Fix job publish returned false',
    );
  }

  return published;
}

/**
 * Publish a triage job to the stas.agents.triage queue.
 *
 * Deduplicates by issue identity within the configured TTL window.
 * Retry count is tracked in the x-retry-count message header.
 *
 * @param data - The triage job data describing the issue to classify.
 * @param options - Optional correlationId, replyTo, and retryCount.
 * @returns true if the message was published, false if deduplicated or failed.
 */
export async function publishTriageJob(
  data: TriageData,
  options?: { correlationId?: string; replyTo?: string; retryCount?: number },
): Promise<boolean> {
  if (!(await isRabbitMqBackendEnabled())) return false;

  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = `triage:${data.installationId}:${repo}#${data.issueNumber}`;

  // Dedup check
  if (await isDuplicate(dedupKey)) {
    log.info(
      { repo, issueNumber: data.issueNumber, dedupKey },
      'Triage job is a duplicate — skipping',
    );
    return false;
  }

  // Ensure RabbitMQ connection
  if (!(await ensureConnected())) {
    log.warn({ repo, issueNumber: data.issueNumber }, 'RabbitMQ unavailable — triage job not published');
    return false;
  }

  const envelope = createEnvelope('triage', data, options?.correlationId, options?.replyTo);
  const publishOptions = buildPublishOptions(options);

  const published = await publish('stas.agents', 'triage', envelope, publishOptions);

  if (published) {
    log.info(
      { repo, issueNumber: data.issueNumber, messageId: envelope.messageId },
      'Triage job published to RabbitMQ',
    );
  } else {
    log.warn(
      { repo, issueNumber: data.issueNumber, messageId: envelope.messageId },
      'Triage job publish returned false',
    );
  }

  return published;
}

/**
 * Gracefully close the Redis connection used for deduplication.
 * Call during application shutdown.
 */
export async function closeProducers(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing Redis dedup connection');
    }
    redis = null;
  }
}

/**
 * Publish a verification job to the stas.agents.verification queue.
 *
 * @param data - The verification data (sandbox_id, test_command).
 * @param options - Optional correlationId, replyTo, and retryCount.
 * @returns true if the message was published, false if deduplicated or failed.
 */
export async function publishVerificationJob(
  data: import('../utils/types.js').VerificationData,
  options?: { correlationId?: string; replyTo?: string; retryCount?: number },
): Promise<boolean> {
  if (!(await isRabbitMqBackendEnabled())) return false;

  const dedupKey = `verification:${data.sandboxId}`;

  // Dedup check
  if (await isDuplicate(dedupKey)) {
    log.info({ sandboxId: data.sandboxId, dedupKey }, 'Verification job is a duplicate — skipping');
    return false;
  }

  // Ensure RabbitMQ connection
  if (!(await ensureConnected())) {
    log.warn({ sandboxId: data.sandboxId }, 'RabbitMQ unavailable — verification job not published');
    return false;
  }

  const envelope = createEnvelope('verification', data, options?.correlationId, options?.replyTo);
  const publishOptions = buildPublishOptions(options);

  const published = await publish('stas.agents', 'verification', envelope, publishOptions);

  if (published) {
    log.info({ sandboxId: data.sandboxId, messageId: envelope.messageId }, 'Verification job published to RabbitMQ');
  } else {
    log.warn({ sandboxId: data.sandboxId, messageId: envelope.messageId }, 'Verification job publish returned false');
  }

  return published;
}

/**
 * Publish a PR creation job to the stas.agents.pr_creation queue.
 *
 * @param data - The PR creation data (repo info, branch, fix summary).
 * @param options - Optional correlationId, replyTo, and retryCount.
 * @returns true if the message was published, false if deduplicated or failed.
 */
export async function publishPRCreationJob(
  data: import('../utils/types.js').PRCreationData,
  options?: { correlationId?: string; replyTo?: string; retryCount?: number },
): Promise<boolean> {
  if (!(await isRabbitMqBackendEnabled())) return false;

  const repo = `${data.repoOwner}/${data.repoName}`;
  const dedupKey = `pr:${data.installationId}:${repo}#${data.issueNumber}`;

  // Dedup check
  if (await isDuplicate(dedupKey)) {
    log.info({ repo, issueNumber: data.issueNumber, dedupKey }, 'PR creation job is a duplicate — skipping');
    return false;
  }

  // Ensure RabbitMQ connection
  if (!(await ensureConnected())) {
    log.warn({ repo, issueNumber: data.issueNumber }, 'RabbitMQ unavailable — PR creation job not published');
    return false;
  }

  const envelope = createEnvelope('pr_creation', data, options?.correlationId, options?.replyTo);
  const publishOptions = buildPublishOptions(options);

  const published = await publish('stas.agents', 'pr_creation', envelope, publishOptions);

  if (published) {
    log.info({ repo, issueNumber: data.issueNumber, messageId: envelope.messageId }, 'PR creation job published to RabbitMQ');
  } else {
    log.warn({ repo, issueNumber: data.issueNumber, messageId: envelope.messageId }, 'PR creation job publish returned false');
  }

  return published;
}

/**
 * Publish a notification job to the stas.events.notifications queue.
 *
 * @param data - The notification data (channel, message, severity).
 * @param options - Optional correlationId, replyTo, and retryCount.
 * @returns true if the message was published, false if deduplicated or failed.
 */
export async function publishNotificationJob(
  data: import('../utils/types.js').NotificationData,
  options?: { correlationId?: string; replyTo?: string; retryCount?: number },
): Promise<boolean> {
  if (!(await isRabbitMqBackendEnabled())) return false;

  const dedupKey = `notification:${data.channel}:${crypto.createHash('md5').update(data.message).digest('hex')}`;

  // Dedup check
  if (await isDuplicate(dedupKey)) {
    log.info({ channel: data.channel, dedupKey }, 'Notification job is a duplicate — skipping');
    return false;
  }

  // Ensure RabbitMQ connection
  if (!(await ensureConnected())) {
    log.warn({ channel: data.channel }, 'RabbitMQ unavailable — notification job not published');
    return false;
  }

  const envelope = createEnvelope('notification', data, options?.correlationId, options?.replyTo);
  const publishOptions = buildPublishOptions(options);

  const published = await publish('stas.events', 'notifications', envelope, publishOptions);

  if (published) {
    log.info({ channel: data.channel, messageId: envelope.messageId }, 'Notification job published to RabbitMQ');
  } else {
    log.warn({ channel: data.channel, messageId: envelope.messageId }, 'Notification job publish returned false');
  }

  return published;
}
