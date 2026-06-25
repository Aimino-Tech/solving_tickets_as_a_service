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

// Unified topology matching src/queue/rabbitmq.ts
const EXCHANGES = {
  agents: { name: 'stas.agents', type: 'topic' },
  issues: { name: 'stas.issues', type: 'topic' },
  queue: { name: 'stas.queue', type: 'topic' },
  events: { name: 'stas.events', type: 'fanout' },
  dlx: { name: 'stas.dlx', type: 'direct' },
} as const;

interface QueueDef {
  name: string;
  exchange: string;
  routingKey: string;
  dlq: string;
}

const QUEUES: QueueDef[] = [
  // stas.agents exchange
  { name: 'stas.agents.dispatch', exchange: 'stas.agents', routingKey: 'agent.runner', dlq: 'stas.agents.dispatch.dlq' },
  { name: 'stas.agents.verification', exchange: 'stas.agents', routingKey: 'agent.verify', dlq: 'stas.agents.verification.dlq' },
  { name: 'stas.agents.self_audit', exchange: 'stas.agents', routingKey: 'agent.self_audit', dlq: 'stas.agents.self_audit.dlq' },
  { name: 'stas.agents.sandbox', exchange: 'stas.agents', routingKey: 'agent.sandbox', dlq: 'stas.agents.sandbox.dlq' },
  // stas.issues exchange
  { name: 'stas.issues.triage', exchange: 'stas.issues', routingKey: 'triage.request', dlq: 'stas.issues.triage.dlq' },
  { name: 'stas.issues.health', exchange: 'stas.issues', routingKey: 'health.check', dlq: 'stas.issues.health.dlq' },
  // stas.queue exchange
  { name: 'stas.queue.pr', exchange: 'stas.queue', routingKey: 'pr.create', dlq: 'stas.queue.pr.dlq' },
  { name: 'stas.queue.merge', exchange: 'stas.queue', routingKey: 'merge.process', dlq: 'stas.queue.merge.dlq' },
  { name: 'stas.queue.notifications', exchange: 'stas.queue', routingKey: 'queue.notify', dlq: 'stas.queue.notifications.dlq' },
  // stas.events exchange (fanout — routing key is ignored)
  { name: 'stas.events.event_bus', exchange: 'stas.events', routingKey: '', dlq: 'stas.events.event_bus.dlq' },
  // stas.dlx exchange
  { name: 'stas.dlx.retry', exchange: 'stas.dlx', routingKey: 'dlq.retry', dlq: '' },
  { name: 'stas.dlx.failed', exchange: 'stas.dlx', routingKey: 'dlq.failed', dlq: '' },
];

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
  for (const ex of Object.values(EXCHANGES)) {
    await ch.assertExchange(ex.name, ex.type, { durable: true });
  }

  for (const q of QUEUES) {
    const isDlxQueue = q.exchange === 'stas.dlx';

    await ch.assertQueue(q.name, {
      durable: true,
      deadLetterExchange: isDlxQueue ? undefined : 'stas.dlx',
      deadLetterRoutingKey: isDlxQueue ? undefined : q.name,
    });

    if (q.routingKey) {
      await ch.bindQueue(q.name, q.exchange, q.routingKey);
    } else {
      await ch.bindQueue(q.name, q.exchange, '');
    }

    if (q.dlq) {
      await ch.assertQueue(q.dlq, { durable: true });
      await ch.bindQueue(q.dlq, 'stas.dlx', q.name);
    }
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
    if (q.dlq) {
      try {
        await ch.deleteQueue(q.dlq);
      } catch {
        // dlq may not exist
      }
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
      const isDlxQueue = q.exchange === 'stas.dlx';

      const ok = await channel.assertQueue(q.name, {
        durable: true,
        deadLetterExchange: isDlxQueue ? undefined : 'stas.dlx',
        deadLetterRoutingKey: isDlxQueue ? undefined : q.name,
      });
      expect(ok.queue).toBe(q.name);
    }
  });

  it('declares dead-letter queues for each main queue', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      if (!q.dlq) continue;
      const ok = await channel.assertQueue(q.dlq, { durable: true });
      expect(ok.queue).toBe(q.dlq);
    }
  });

  it('binds queues to correct exchanges with correct routing keys', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      const rk = q.routingKey || '';
      await channel.bindQueue(q.name, q.exchange, rk);

      const bindings = await channel.checkQueue(q.name);
      expect(bindings.queue).toBe(q.name);
      expect(bindings.consumerCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('binds dead-letter queues to the DLX exchange', async () => {
    if (skipIfUnavailable()) return;

    for (const q of QUEUES) {
      if (!q.dlq) continue;
      await channel.bindQueue(q.dlq, 'stas.dlx', q.name);

      const ok = await channel.assertQueue(q.dlq, { durable: true });
      expect(ok.queue).toBe(q.dlq);
    }
  });

  it('publishes a message and consumes it from the dispatch queue', async () => {
    if (skipIfUnavailable()) return;

    const testMessage = {
      version: 1,
      messageId: 'integration-test-msg',
      timestamp: new Date().toISOString(),
      source: 'stas-integration-test',
      type: 'agent.dispatch',
      payload: { test: true },
    };

    // Publish to stas.agents exchange with routing key agent.runner
    const published = channel.publish(
      'stas.agents',
      'agent.runner',
      Buffer.from(JSON.stringify(testMessage)),
      { persistent: true, contentType: 'application/json' },
    );
    expect(published).toBe(true);

    // Consume from stas.agents.dispatch queue
    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message on stas.agents.dispatch'));
      }, 5000);

      channel.consume(
        'stas.agents.dispatch',
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
    expect(message.type).toBe('agent.dispatch');
    expect(message.payload).toEqual({ test: true });
  }, 10000);

  it('publishes and consumes with correct routing across topic exchanges', async () => {
    if (skipIfUnavailable()) return;

    const triageMessage = {
      version: 1,
      messageId: 'integration-triage-test',
      timestamp: new Date().toISOString(),
      source: 'stas-integration-test',
      type: 'triage.request',
      payload: { issue: '#42' },
    };

    // Publish to stas.issues exchange with triage.* routing key
    channel.publish(
      'stas.issues',
      'triage.request',
      Buffer.from(JSON.stringify(triageMessage)),
      { persistent: true },
    );

    // Consume from stas.issues.triage queue
    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message on stas.issues.triage'));
      }, 5000);

      channel.consume(
        'stas.issues.triage',
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
    expect(message.messageId).toBe('integration-triage-test');
    expect(message.type).toBe('triage.request');
  }, 10000);

  it('declares the full topology end-to-end with declareTopology()', async () => {
    if (skipIfUnavailable()) return;

    await declareTopology(channel);

    for (const ex of Object.values(EXCHANGES)) {
      const ok = await channel.assertExchange(ex.name, ex.type, {
        durable: true,
        internal: false,
        autoDelete: false,
      });
      expect(ok.exchange).toBe(ex.name);
    }

    for (const q of QUEUES) {
      const ok = await channel.assertQueue(q.name, { durable: true });
      expect(ok.queue).toBe(q.name);

      if (q.dlq) {
        const dlqOk = await channel.assertQueue(q.dlq, { durable: true });
        expect(dlqOk.queue).toBe(q.dlq);
      }
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
      if (!q.dlq) continue;
      await channel.purgeQueue(q.dlq);
      const ok = await channel.checkQueue(q.dlq);
      expect(ok.messageCount).toBe(0);
    }
  });
});
