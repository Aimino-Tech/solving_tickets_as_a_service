import { describe, it, expect } from 'vitest';
import { createMessageEnvelope } from '../../queue/amqp/producer.js';
import { RETRY_DELAYS_MS, EXCHANGE_DIRECT, EXCHANGE_RETRY, EXCHANGE_DLQ, QUEUE_PIPELINE, QUEUE_DLQ } from '../../queue/amqp/exchanges.js';
import { getInitialRetryDelay, getNextRetryDelay, getRetryQueueName } from '../../queue/amqp/retry.js';

describe('AMQP Producer', () => {
  it('creates a valid message envelope', () => {
    const envelope = createMessageEnvelope('pipeline', { jobId: '123' }, 'test-service');
    expect(envelope.version).toBe(1);
    expect(envelope.messageId).toBeDefined();
    expect(envelope.timestamp).toBeDefined();
    expect(envelope.source).toBe('test-service');
    expect(envelope.type).toBe('pipeline');
    expect(envelope.payload).toEqual({ jobId: '123' });
  });

  it('uses default source when not provided', () => {
    const envelope = createMessageEnvelope('test', {});
    expect(envelope.source).toBe('stas-bot');
  });

  it('generates unique message IDs', () => {
    const e1 = createMessageEnvelope('test', {});
    const e2 = createMessageEnvelope('test', {});
    expect(e1.messageId).not.toBe(e2.messageId);
  });
});

describe('AMQP Exchanges', () => {
  it('has correct exchange names', () => {
    expect(EXCHANGE_DIRECT).toBe('stas.direct');
    expect(EXCHANGE_RETRY).toBe('stas.retry');
    expect(EXCHANGE_DLQ).toBe('stas.dlq');
  });

  it('has correct queue names', () => {
    expect(QUEUE_PIPELINE).toBe('stas.job.pipeline');
    expect(QUEUE_DLQ).toBe('stas.job.dlq');
  });

  it('has valid retry delays', () => {
    expect(RETRY_DELAYS_MS).toEqual([30000, 120000, 300000, 900000]);
    expect(RETRY_DELAYS_MS.length).toBe(4);
  });
});

describe('AMQP Retry', () => {
  it('returns initial retry delay', () => {
    expect(getInitialRetryDelay()).toBe(30000);
  });

  it('generates correct retry queue name', () => {
    expect(getRetryQueueName(30000)).toBe('stas.retry.30000ms');
    expect(getRetryQueueName(120000)).toBe('stas.retry.120000ms');
  });

  it('returns next retry delay', () => {
    expect(getNextRetryDelay(30000)).toBe(120000);
    expect(getNextRetryDelay(120000)).toBe(300000);
    expect(getNextRetryDelay(900000)).toBeNull();
  });
});
