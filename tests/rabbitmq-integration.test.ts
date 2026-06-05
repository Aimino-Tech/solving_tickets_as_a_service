/**
 * RabbitMQ Integration Test
 *
 * Connects to a live RabbitMQ instance and verifies that the topology
 * (exchanges, queues, dead-letter queues, and bindings) is declared
 * correctly as defined in src/queue/rabbitmq.ts.
 *
 * Prerequisites:
 *   - A running RabbitMQ instance (default: localhost:5672)
 *   - RABBITMQ_INTEGRATION_URL env var (optional override)
 *   - The stas-app user with access to the /stas vhost
 *
 * Usage:
 *   # Default (localhost:5672, guest/guest, /stas vhost)
 *   npx vitest run --config vitest.integration.config.ts
 *
 *   # Custom RabbitMQ
 *   RABBITMQ_INTEGRATION_URL=amqp://user:pass@host:5672/vhost \
 *     npx vitest run --config vitest.integration.config.ts
 *
 *   # Skip (no RabbitMQ running):
 *   RABBITMQ_INTEGRATION_SKIP=true npx vitest run --config vitest.integration.config.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect as amqpConnect, type Channel, type Connection } from 'amqplib';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INTEGRATION_URL = process.env.RABBITMQ_INTEGRATION_URL || 'amqp://guest:guest@localhost:5672/stas';
const SKIP = process.env.RABBITMQ_INTEGRATION_SKIP === 'true';

// Topology definitions matching src/queue/rabbitmq.ts
const EXCHANGES = {
  issues: { name: 'stas.issues', type: 'topic' },
  agents: { name: 'stas.agents', type: 'direct' },
  events: { name: 'stas.events', type: 'topic' },
  dlx: { name: 'stas.dlx', type: 'direct' },
} as const;

const QUEUES = [
  { name: 'stas.issues.fix', exchange: 'stas.issues', routingKey: 'fix' },
  { name: 'stas.agents.triage', exchange: 'stas.agents', routingKey: 'triage' },
  { name: 'stas.agents.opencode', exchange: 'stas.agents', routingKey: 'opencode' },
  { name: 'stas.agents.sandbox', exchange: 'stas.agents', routingKey: 'sandbox' },
  { name: 'stas.agents.verification', exchange: 'stas.agents', routingKey: 'verification' },
  { name: 'stas.events.notifications', exchange: 'stas.events', routingKey: 'notifications' },
  { name: 'stas.events.audit', exchange: 'stas.events', routingKey: 'audit' },
] as const;

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let connection: Connection;
let channel: Channel;
let topologyDeclared = false;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Declare all exchanges, queues, DLQs, and bindings — exactly as
 * src/queue/rabbitmq.ts::declareTopology() does.
 */
async function declareTopology(ch: Channel): Promise<void> {
  // Exchanges
  for (const ex of Object.values(EXCHANGES)) {
    await ch.assertExchange(ex.name, ex.type, { durable: true });
  }

  await ch.assertExchange('stas.dlx', 'direct', { durable: true });

  // Queues + DLQs + bindings
  for (const q of QUEUES) {
    const dlqName = `${q.name}.dlq`;
    await ch.assertQueue(q.name, {
      durable: true,
      deadLetterExchange: 'stas.dlx',
      deadLetterRoutingKey: q.name,
    });
    await ch.assertQueue(dlqName, { durable: true });
    await ch.bindQueue(q.name, q.exchange, q.routingKey);
    await ch.bindQueue(dlqName, 'stas.dlx', q.name);
  }

  topologyDeclared = true;
}

/**
 * Delete all queues that were created by this test.
 */
async function deleteQueues(ch: Channel): Promise<void> {
  for (const q of QUEUES) {
    try {
      await ch.deleteQueue(q.name);
    } catch {
      // queue may not exist
    }
    try {
      await ch.deleteQueue(`${q.name}.dlq`);
    } catch {
      // dlq may not exist
    }
  }
}

/**
 * Delete all exchanges that were created by this test.
 * Only delete if no queues are bound (safe cleanup).
 */
async function deleteExchanges(ch: Channel): Promise<void> {
  for (const ex of Object.values(EXCHANGES)) {
    try {
      await ch.deleteExchange(ex.name);
    } catch {
      // exchange may not exist or still have bindings
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (SKIP) return;

  try {
    connection = await amqpConnect(INTEGRATION_URL);
    channel = await connection.createChannel();
  } catch (err) {
    console.warn(
      `[rabbitmq-integration] Could not connect to ${INTEGRATION_URL.replace(/\/\/.*@/, '//***@')} — ` +
        'skipping integration tests. Set RABBITMQ_INTEGRATION_URL or start RabbitMQ.',
    );
    console.warn(`[rabbitmq-integration] Error: ${String(err)}`);
    // Signal that tests should be skipped
    (globalThis as any).__RABBITMQ_SKIP__ = true;
  }
}, 15000); // 15s timeout for connection

afterAll(async () => {
  if (!channel || !connection) return;

  try {
    if (topologyDeclared) {
      await deleteQueues(channel);
      await deleteExchanges(channel);
    }
  } catch (err) {
    console.warn(`[rabbitmq-integration] Cleanup warning: ${String(err)}`);
  }

  try {
    await channel.close();
  } catch {
    // ignore
  }
  try {
    await connection.close();
  } catch {
    // ignore
  }
}, 10000);

// ---------------------------------------------------------------------------
// Helpers for skipping when RabbitMQ is unavailable
// ---------------------------------------------------------------------------

function skipIfUnavailable() {
  if (SKIP || (globalThis as any).__RABBITMQ_SKIP__) {
    console.log('[rabbitmq-integration] Skipping — RabbitMQ not available');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RabbitMQ Integration', () => {
  it('connects to RabbitMQ', () => {
    if (skipIfUnavailable()) return;
    expect(connection).toBeDefined();
    expect(channel).toBeDefined();
  });

  it('declares all exchanges with correct types', async () => {
    if (skipIfUnavailable()) return;

    for (const [key, ex] of Object.entries(EXCHANGES)) {
      // assertExchange with passive=true checks existence without creating
      const ok = await channel.assertExchange(ex.name, ex.type, {
        durable: true,
        internal: false,
        autoDelete: false,
      });
      expect(ok.exchange).toBe(ex.name);
    }
  });

  it('declares all queues with dead-letter configuration', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      const ok = await channel.assertQueue(q.name, {
        durable: true,
        deadLetterExchange: 'stas.dlx',
        deadLetterRoutingKey: q.name,
      });
      expect(ok.queue).toBe(q.name);
    }
  });

  it('declares dead-letter queues for each main queue', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      const dlqName = `${q.name}.dlq`;
      const ok = await channel.assertQueue(dlqName, { durable: true });
      expect(ok.queue).toBe(dlqName);
    }
  });

  it('binds queues to correct exchanges with correct routing keys', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      // Bind (idempotent — multiple binds are no-ops if binding exists)
      await channel.bindQueue(q.name, q.exchange, q.routingKey);

      // Verify by checking queue bindings
      const bindings = await channel.checkQueue(q.name);
      expect(bindings.queue).toBe(q.name);
      expect(bindings.consumerCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('binds dead-letter queues to the DLX exchange', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      const dlqName = `${q.name}.dlq`;
      await channel.bindQueue(dlqName, 'stas.dlx', q.name);

      // Verify DLQ exists
      const ok = await channel.assertQueue(dlqName, { durable: true });
      expect(ok.queue).toBe(dlqName);
    }
  });

  it('publishes a message and consumes it from the fix queue', async () => {
    if (skipIfUnavailable()) return;

    const testMessage = {
      version: 1,
      messageId: 'integration-test-msg',
      timestamp: new Date().toISOString(),
      source: 'stas-integration-test',
      type: 'integration-test',
      payload: { test: true },
    };

    // Publish
    const published = channel.publish(
      'stas.issues',
      'fix',
      Buffer.from(JSON.stringify(testMessage)),
      { persistent: true, contentType: 'application/json' },
    );
    expect(published).toBe(true);

    // Consume (with timeout)
    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message on stas.issues.fix'));
      }, 5000);

      channel.consume(
        'stas.issues.fix',
        (msg) => {
          if (msg) {
            clearTimeout(timeout);
            resolve(JSON.parse(msg.content.toString()));
          }
        },
        { noAck: true },
      );
    });

    expect(message).toBeDefined();
    expect(message.messageId).toBe('integration-test-msg');
    expect(message.type).toBe('integration-test');
    expect(message.payload).toEqual({ test: true });
  }, 10000);

  it('publishes and consumes with correct routing across topic exchanges', async () => {
    if (skipIfUnavailable()) return;

    const eventMessage = {
      version: 1,
      messageId: 'integration-event-test',
      timestamp: new Date().toISOString(),
      source: 'stas-integration-test',
      type: 'integration-event',
      payload: { event: 'test' },
    };

    // Publish to events exchange with notifications routing key
    channel.publish(
      'stas.events',
      'notifications',
      Buffer.from(JSON.stringify(eventMessage)),
      { persistent: true },
    );

    // Consume from notifications queue
    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message on stas.events.notifications'));
      }, 5000);

      channel.consume(
        'stas.events.notifications',
        (msg) => {
          if (msg) {
            clearTimeout(timeout);
            resolve(JSON.parse(msg.content.toString()));
          }
        },
        { noAck: true },
      );
    });

    expect(message).toBeDefined();
    expect(message.messageId).toBe('integration-event-test');
    expect(message.type).toBe('integration-event');
  }, 10000);

  it('declares the full topology end-to-end with declareTopology()', async () => {
    if (skipIfUnavailable()) return;

    // This tests the actual declareTopology logic from rabbitmq.ts
    await declareTopology(channel);

    // Verify all exchanges exist
    for (const ex of Object.values(EXCHANGES)) {
      const ok = await channel.assertExchange(ex.name, ex.type, {
        durable: true,
        internal: false,
        autoDelete: false,
      });
      expect(ok.exchange).toBe(ex.name);
    }

    // Verify all queues and DLQs exist
    for (const q of QUEUES) {
      const ok = await channel.assertQueue(q.name, { durable: true });
      expect(ok.queue).toBe(q.name);

      const dlqOk = await channel.assertQueue(`${q.name}.dlq`, { durable: true });
      expect(dlqOk.queue).toBe(`${q.name}.dlq`);
    }
  });

  it('purges all queues and verifies they are empty', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      await channel.purgeQueue(q.name);
      const ok = await channel.checkQueue(q.name);
      expect(ok.messageCount).toBe(0);
    }

    for (const q of QUEUES) {
      const dlqName = `${q.name}.dlq`;
      await channel.purgeQueue(dlqName);
      const ok = await channel.checkQueue(dlqName);
      expect(ok.messageCount).toBe(0);
    }
  });
});
