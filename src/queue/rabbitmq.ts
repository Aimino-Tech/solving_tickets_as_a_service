import { connect as amqpConnect, type Channel } from 'amqplib';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

type ChannelModel = Awaited<ReturnType<typeof amqpConnect>>;

const log = rootLogger.child({ module: 'rabbitmq' });

let channelModel: ChannelModel | null = null;
let publishChannel: Channel | null = null;
let initialised = false;

export const EXCHANGES = {
  agents: { name: 'stas.agents', type: 'topic', options: { durable: true } },
  issues: { name: 'stas.issues', type: 'topic', options: { durable: true } },
  queue: { name: 'stas.queue', type: 'topic', options: { durable: true } },
  events: { name: 'stas.events', type: 'fanout', options: { durable: true } },
  dlx: { name: 'stas.dlx', type: 'direct', options: { durable: true } },
} as const;

interface QueueBinding {
  name: string;
  exchange: string;
  routingKey: string;
  dlq: string;
  dlqRoutingKey: string;
}

export const QUEUES: Record<string, QueueBinding> = {
  'agents.dispatch': {
    name: 'stas.agents.dispatch',
    exchange: 'stas.agents',
    routingKey: 'agent.runner',
    dlq: 'stas.agents.dispatch.dlq',
    dlqRoutingKey: 'stas.agents.dispatch',
  },
  'agents.verification': {
    name: 'stas.agents.verification',
    exchange: 'stas.agents',
    routingKey: 'agent.verify',
    dlq: 'stas.agents.verification.dlq',
    dlqRoutingKey: 'stas.agents.verification',
  },
  'agents.self_audit': {
    name: 'stas.agents.self_audit',
    exchange: 'stas.agents',
    routingKey: 'agent.self_audit',
    dlq: 'stas.agents.self_audit.dlq',
    dlqRoutingKey: 'stas.agents.self_audit',
  },
  'agents.sandbox': {
    name: 'stas.agents.sandbox',
    exchange: 'stas.agents',
    routingKey: 'agent.sandbox',
    dlq: 'stas.agents.sandbox.dlq',
    dlqRoutingKey: 'stas.agents.sandbox',
  },
  'issues.triage': {
    name: 'stas.issues.triage',
    exchange: 'stas.issues',
    routingKey: 'triage.*',
    dlq: 'stas.issues.triage.dlq',
    dlqRoutingKey: 'stas.issues.triage',
  },
  'issues.health': {
    name: 'stas.issues.health',
    exchange: 'stas.issues',
    routingKey: 'health.*',
    dlq: 'stas.issues.health.dlq',
    dlqRoutingKey: 'stas.issues.health',
  },
  'queue.pr': {
    name: 'stas.queue.pr',
    exchange: 'stas.queue',
    routingKey: 'pr.create',
    dlq: 'stas.queue.pr.dlq',
    dlqRoutingKey: 'stas.queue.pr',
  },
  'queue.merge': {
    name: 'stas.queue.merge',
    exchange: 'stas.queue',
    routingKey: 'merge.process',
    dlq: 'stas.queue.merge.dlq',
    dlqRoutingKey: 'stas.queue.merge',
  },
  'queue.notifications': {
    name: 'stas.queue.notifications',
    exchange: 'stas.queue',
    routingKey: 'queue.notify',
    dlq: 'stas.queue.notifications.dlq',
    dlqRoutingKey: 'stas.queue.notifications',
  },
  'events.event_bus': {
    name: 'stas.events.event_bus',
    exchange: 'stas.events',
    routingKey: '',
    dlq: 'stas.events.event_bus.dlq',
    dlqRoutingKey: 'stas.events.event_bus',
  },
  'dlx.retry': {
    name: 'stas.dlx.retry',
    exchange: 'stas.dlx',
    routingKey: 'dlq.retry',
    dlq: '',
    dlqRoutingKey: '',
  },
  'dlx.failed': {
    name: 'stas.dlx.failed',
    exchange: 'stas.dlx',
    routingKey: 'dlq.failed',
    dlq: '',
    dlqRoutingKey: '',
  },
};

function getUrl(): string {
  return config.queue.rabbitmqUrl || 'amqp://guest:guest@localhost:5672/stas';
}

export async function connect(): Promise<ChannelModel> {
  if (channelModel) {
    return channelModel;
  }

  const url = getUrl();
  log.info({ url: url.replace(/\/\/.*@/, '//***@') }, 'Connecting to RabbitMQ');

  const cm = await amqpConnect(url);
  cm.connection.on('error', (err) => {
    log.error({ err: String(err) }, 'RabbitMQ connection error');
  });
  cm.connection.on('close', () => {
    log.warn('RabbitMQ connection closed');
    channelModel = null;
    publishChannel = null;
    initialised = false;
  });

  channelModel = cm;
  log.info('Connected to RabbitMQ');
  return cm;
}

export async function declareTopology(): Promise<void> {
  const cm = await connect();
  const ch = await cm.createChannel();

  try {
    for (const ex of Object.values(EXCHANGES)) {
      await ch.assertExchange(ex.name, ex.type, ex.options);
    }

    for (const [, q] of Object.entries(QUEUES)) {
      if (!q.name) {
        continue;
      }

      const isDlx = q.exchange === 'stas.dlx';

      await ch.assertQueue(q.name, {
        durable: true,
        deadLetterExchange: isDlx ? undefined : 'stas.dlx',
        deadLetterRoutingKey: isDlx ? undefined : q.name,
      });

      await ch.bindQueue(q.name, q.exchange, q.routingKey);

      if (q.dlq) {
        await ch.assertQueue(q.dlq, { durable: true });
        await ch.bindQueue(q.dlq, 'stas.dlx', q.dlqRoutingKey);
      }
    }

    initialised = true;
    log.info('RabbitMQ topology declared');
  } finally {
    await ch.close();
  }
}

export async function initPublishChannel(): Promise<Channel> {
  if (publishChannel) {
    return publishChannel;
  }

  const cm = await connect();
  publishChannel = await cm.createChannel();

  if (!initialised) {
    await declareTopology();
  }

  publishChannel.on('error', (err) => {
    log.error({ err: String(err) }, 'Publish channel error');
    publishChannel = null;
  });
  publishChannel.on('close', () => {
    log.warn('Publish channel closed');
    publishChannel = null;
  });

  return publishChannel;
}

export function getPublishChannel(): Channel {
  if (!publishChannel) {
    throw new Error('RabbitMQ publish channel not initialised — call initPublishChannel() first');
  }
  return publishChannel;
}

export function isConnected(): boolean {
  return channelModel !== null && publishChannel !== null;
}

export async function publish(
  exchange: string,
  routingKey: string,
  content: unknown,
): Promise<boolean> {
  const ch = await initPublishChannel();
  const buffer = Buffer.from(JSON.stringify(content));

  const published = ch.publish(exchange, routingKey, buffer, {
    persistent: true,
    contentType: 'application/json',
  });

  if (!published) {
    log.warn({ exchange, routingKey }, 'Message not published (channel buffer full)');
  }

  return published;
}

export async function disconnect(): Promise<void> {
  if (publishChannel) {
    try {
      await publishChannel.close();
    } catch {
      // ignore
    }
    publishChannel = null;
  }

  if (channelModel) {
    try {
      await channelModel.close();
    } catch {
      // ignore
    }
    channelModel = null;
  }

  initialised = false;
  log.info('Disconnected from RabbitMQ');
}
