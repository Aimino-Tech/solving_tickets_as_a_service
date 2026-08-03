import type { Channel } from 'amqplib';

export interface ExchangeDeclaration {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  durable: boolean;
}

export interface QueueDeclaration {
  name: string;
  durable: boolean;
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  messageTtl?: number;
}

export interface BindingDeclaration {
  queue: string;
  exchange: string;
  routingKey: string;
}

export const EXCHANGES: ExchangeDeclaration[] = [
  { name: 'syntaro.direct', type: 'direct', durable: true },
  { name: 'syntaro.retry', type: 'direct', durable: true },
  { name: 'syntaro.dlx', type: 'direct', durable: true },
];

export const QUEUES: QueueDeclaration[] = [
  { name: 'syntaro.job.pipeline', durable: true, deadLetterExchange: 'syntaro.dlx', deadLetterRoutingKey: 'syntaro.job.pipeline' },
  { name: 'syntaro.job.dlq', durable: true },
  { name: 'syntaro.retry.30s', durable: true, deadLetterExchange: 'syntaro.dlx', deadLetterRoutingKey: 'syntaro.retry', messageTtl: 30_000 },
  { name: 'syntaro.retry.2m', durable: true, deadLetterExchange: 'syntaro.dlx', deadLetterRoutingKey: 'syntaro.retry', messageTtl: 120_000 },
  { name: 'syntaro.retry.5m', durable: true, deadLetterExchange: 'syntaro.dlx', deadLetterRoutingKey: 'syntaro.retry', messageTtl: 300_000 },
  { name: 'syntaro.retry.15m', durable: true, deadLetterExchange: 'syntaro.dlx', deadLetterRoutingKey: 'syntaro.retry', messageTtl: 900_000 },
];

export const BINDINGS: BindingDeclaration[] = [
  { queue: 'syntaro.job.pipeline', exchange: 'syntaro.direct', routingKey: 'syntaro.job.pipeline' },
  { queue: 'syntaro.job.dlq', exchange: 'syntaro.dlx', routingKey: 'syntaro.job.pipeline' },
  { queue: 'syntaro.job.dlq', exchange: 'syntaro.dlx', routingKey: 'syntaro.retry' },
  { queue: 'syntaro.retry.30s', exchange: 'syntaro.retry', routingKey: 'syntaro.retry.30s' },
  { queue: 'syntaro.retry.2m', exchange: 'syntaro.retry', routingKey: 'syntaro.retry.2m' },
  { queue: 'syntaro.retry.5m', exchange: 'syntaro.retry', routingKey: 'syntaro.retry.5m' },
  { queue: 'syntaro.retry.15m', exchange: 'syntaro.retry', routingKey: 'syntaro.retry.15m' },
];

export async function declareTopology(channel: Channel): Promise<void> {
  for (const ex of EXCHANGES) {
    await channel.assertExchange(ex.name, ex.type, { durable: ex.durable });
  }

  for (const q of QUEUES) {
    const opts: Record<string, unknown> = { durable: q.durable };
    if (q.deadLetterExchange) {
      opts.deadLetterExchange = q.deadLetterExchange;
    }
    if (q.deadLetterRoutingKey) {
      opts.deadLetterRoutingKey = q.deadLetterRoutingKey;
    }
    if (q.messageTtl !== undefined) {
      opts.messageTtl = q.messageTtl;
    }
    await channel.assertQueue(q.name, opts);
  }

  for (const b of BINDINGS) {
    await channel.bindQueue(b.queue, b.exchange, b.routingKey);
  }
}
