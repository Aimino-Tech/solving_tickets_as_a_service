/**
 * Per-tenant queue management using BullMQ.
 *
 * Each tenant gets an isolated BullMQ queue named `stas.tenant.{tenantId}`
 * with per-queue prefetch (concurrency) control, dead letter configuration,
 * and binding to the dispatch exchange via RabbitMQ routing keys.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 * BullMQ queues are Redis-backed. Each tenant queue:
 *   - Has a unique name namespaced by tenant ID
 *   - Uses per-queue concurrency (prefetch) from config
 *   - Has a corresponding dead-letter queue
 *   - Is bound to the RabbitMQ dispatch exchange with routing key `tenant.{tenantId}`
 *   - Supports dynamic creation and teardown
 *
 * The RabbitMQ binding is optional — if RabbitMQ is configured, tenant queues
 * are bound so that external dispatch can route to specific tenants.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Queue } from 'bullmq';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { declareTopology, getPublishChannel, connect as connectRabbitMQ } from './rabbitmq.js';

const log = rootLogger.child({ module: 'tenant-queues' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPATCH_EXCHANGE = 'stas.agents';
const DLX_NAME = 'stas.dlx';

// ---------------------------------------------------------------------------
// In-memory registry of created tenant queues
// ---------------------------------------------------------------------------

const tenantQueues = new Map<string, Queue>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the BullMQ queue name for a given tenant.
 */
export function getTenantQueueName(tenantId: string): string {
  return `${config.queue.perTenantPrefix}${tenantId}`;
}

/**
 * Get the dead-letter queue name for a given tenant.
 */
export function getTenantDLQName(tenantId: string): string {
  return `${config.queue.perTenantPrefix}${tenantId}.dlq`;
}

/**
 * Ensure a BullMQ queue exists for the given tenant.
 *
 * Creates the queue, its dead-letter queue, and (optionally) binds it
 * to the RabbitMQ dispatch exchange with routing key `tenant.{tenantId}`.
 *
 * Idempotent — safe to call multiple times for the same tenant.
 */
export async function ensureTenantQueue(tenantId: string): Promise<Queue> {
  // Return cached instance if already created
  const existing = tenantQueues.get(tenantId);
  if (existing) {
    return existing;
  }

  const queueName = getTenantQueueName(tenantId);
  const dlqName = getTenantDLQName(tenantId);

  log.info({ tenantId, queueName }, 'Creating per-tenant BullMQ queue');

  // Create the dead-letter queue first (BullMQ style)
  const dlq = new Queue(dlqName, {
    connection: {
      url: config.queue.redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis retry for tenant DLQ ${tenantId} in ${delay}ms`);
        return delay;
      },
    },
    defaultJobOptions: {
      removeOnComplete: { count: config.queue.keepCompleted },
      removeOnFail: { count: config.queue.keepFailed },
    },
  });
  log.info({ tenantId, dlqName }, 'Tenant dead-letter queue created');

  // Create the main tenant queue with dead letter configuration
  const queue = new Queue(queueName, {
    connection: {
      url: config.queue.redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        log.warn({ attempt: times }, `Redis retry for tenant queue ${tenantId} in ${delay}ms`);
        return delay;
      },
    },
    defaultJobOptions: {
      attempts: config.queue.maxRetries,
      backoff: {
        type: 'exponential',
        delay: 30_000,
      },
      removeOnComplete: {
        count: config.queue.keepCompleted,
      },
      removeOnFail: {
        count: config.queue.keepFailed,
      },
    },
  });

  log.info(
    { tenantId, queueName, prefetch: config.queue.perTenantPrefetch },
    'Tenant queue created with per-queue prefetch control',
  );

  // Register the queue
  tenantQueues.set(tenantId, queue);

  // Bind to RabbitMQ dispatch exchange (best-effort, non-blocking)
  try {
    await bindToDispatchExchange(tenantId, queueName);
  } catch (err) {
    log.warn(
      { err: String(err), tenantId },
      'Failed to bind tenant queue to RabbitMQ dispatch exchange — RabbitMQ may be unavailable',
    );
  }

  return queue;
}

/**
 * Get the BullMQ queue instance for a tenant.
 * Returns undefined if the queue has not been created yet.
 */
export function getTenantQueue(tenantId: string): Queue | undefined {
  return tenantQueues.get(tenantId);
}

/**
 * Remove a tenant's queue and its dead-letter queue.
 * Drains all pending jobs before removal.
 */
export async function removeTenantQueue(tenantId: string): Promise<void> {
  const queue = tenantQueues.get(tenantId);
  if (!queue) {
    log.warn({ tenantId }, 'No tenant queue found to remove');
    return;
  }

  const queueName = getTenantQueueName(tenantId);
  const dlqName = getTenantDLQName(tenantId);

  log.info({ tenantId, queueName }, 'Removing per-tenant queue');

  try {
    await queue.drain();
    await queue.obliterate({ force: true });
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Failed to drain/obliterate tenant queue');
  }

  try {
    await queue.close();
  } catch (err) {
    log.warn({ err: String(err), tenantId }, 'Error closing tenant queue');
  }

  // Clean up the DLQ too
  try {
    const dlq = new Queue(dlqName, {
      connection: { url: config.queue.redisUrl, maxRetriesPerRequest: null, enableReadyCheck: true },
    });
    await dlq.drain();
    await dlq.obliterate({ force: true });
    await dlq.close();
  } catch (err) {
    log.warn({ err: String(err), tenantId }, 'Error cleaning up tenant DLQ');
  }

  tenantQueues.delete(tenantId);
  log.info({ tenantId }, 'Tenant queue removed');
}

/**
 * Get the list of all active tenant IDs.
 */
export function getActiveTenants(): string[] {
  return Array.from(tenantQueues.keys());
}

/**
 * Get the count of active tenant queues.
 */
export function getActiveTenantCount(): number {
  return tenantQueues.size;
}

/**
 * Close all tenant queues (for graceful shutdown).
 */
export async function closeAllTenantQueues(): Promise<void> {
  const entries = Array.from(tenantQueues.entries());
  log.info({ count: entries.length }, 'Closing all tenant queues');

  for (const [tenantId, queue] of entries) {
    try {
      await queue.close();
      log.debug({ tenantId }, 'Tenant queue closed');
    } catch (err) {
      log.warn({ err: String(err), tenantId }, 'Error closing tenant queue');
    }
  }

  tenantQueues.clear();
  log.info('All tenant queues closed');
}

// ---------------------------------------------------------------------------
// Internal: RabbitMQ binding
// ---------------------------------------------------------------------------

/**
 * Bind the tenant's BullMQ queue to the RabbitMQ dispatch exchange.
 *
 * This allows external dispatch mechanisms to route messages to a specific
 * tenant's queue using routing key `tenant.{tenantId}`.
 *
 * The tenant queue is declared in RabbitMQ as a durable queue with a dead-letter
 * exchange, and bound to the dispatch exchange.
 */
async function bindToDispatchExchange(tenantId: string, queueName: string): Promise<void> {
  let channel;
  try {
    // Connect to RabbitMQ and get a channel
    await connectRabbitMQ();
    const cm = await connectRabbitMQ();
    channel = await cm.createChannel();
  } catch (err) {
    log.warn({ err: String(err), tenantId }, 'RabbitMQ connection unavailable for tenant queue binding');
    return;
  }

  try {
    // Ensure the dispatch exchange exists
    await channel.assertExchange(DISPATCH_EXCHANGE, 'topic', { durable: true });

    // Ensure the dead-letter exchange exists
    await channel.assertExchange(DLX_NAME, 'direct', { durable: true });

    // Declare the tenant queue with dead-letter config
    await channel.assertQueue(queueName, {
      durable: true,
      deadLetterExchange: DLX_NAME,
      deadLetterRoutingKey: queueName,
      arguments: {
        'x-max-priority': 10,
        'x-queue-type': 'quorum',
      },
    });

    // Bind the queue to the dispatch exchange with the tenant routing key
    const routingKey = `tenant.${tenantId}`;
    await channel.bindQueue(queueName, DISPATCH_EXCHANGE, routingKey);

    // Declare the dead-letter queue for this tenant
    const dlqName = getTenantDLQName(tenantId);
    await channel.assertQueue(dlqName, {
      durable: true,
    });
    await channel.bindQueue(dlqName, DLX_NAME, queueName);

    log.info(
      { tenantId, queueName, routingKey, exchange: DISPATCH_EXCHANGE },
      'Tenant queue bound to dispatch exchange',
    );
  } catch (err) {
    log.warn(
      { err: String(err), tenantId },
      'Failed to bind tenant queue to RabbitMQ — continuing without RabbitMQ binding',
    );
  } finally {
    try {
      await channel.close();
    } catch {
      // non-fatal
    }
  }
}
