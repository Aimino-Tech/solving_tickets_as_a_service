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
  { name: 'stas.direct', type: 'direct', durable: true },
  { name: 'stas.retry', type: 'direct', durable: true },
  { name: 'stas.dlx', type: 'direct', durable: true },
];

export const QUEUES: QueueDeclaration[] = [
  { name: 'stas.job.pipeline', durable: true, deadLetterExchange: 'stas.dlx', deadLetterRoutingKey: 'stas.job.pipeline' },
  { name: 'stas.job.dlq', durable: true },
  { name: 'stas.retry.30s', durable: true, deadLetterExchange: 'stas.dlx', deadLetterRoutingKey: 'stas.retry', messageTtl: 30_000 },
  { name: 'stas.retry.2m', durable: true, deadLetterExchange: 'stas.dlx', deadLetterRoutingKey: 'stas.retry', messageTtl: 120_000 },
  { name: 'stas.retry.5m', durable: true, deadLetterExchange: 'stas.dlx', deadLetterRoutingKey: 'stas.retry', messageTtl: 300_000 },
  { name: 'stas.retry.15m', durable: true, deadLetterExchange: 'stas.dlx', deadLetterRoutingKey: 'stas.retry', messageTtl: 900_000 },
];

export const BINDINGS: BindingDeclaration[] = [
  { queue: 'stas.job.pipeline', exchange: 'stas.direct', routingKey: 'stas.job.pipeline' },
  { queue: 'stas.job.dlq', exchange: 'stas.dlx', routingKey: 'stas.job.pipeline' },
  { queue: 'stas.job.dlq', exchange: 'stas.dlx', routingKey: 'stas.retry' },
  { queue: 'stas.retry.30s', exchange: 'stas.retry', routingKey: 'stas.retry.30s' },
  { queue: 'stas.retry.2m', exchange: 'stas.retry', routingKey: 'stas.retry.2m' },
  { queue: 'stas.retry.5m', exchange: 'stas.retry', routingKey: 'stas.retry.5m' },
  { queue: 'stas.retry.15m', exchange: 'stas.retry', routingKey: 'stas.retry.15m' },
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
