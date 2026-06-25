/**
 * RabbitMQ exchange and queue declarations for STAS.
 *
 * Mirrors the Celery-side declarations in workers/celeryconfig.py.
 * The `stas` topic exchange routes all agent pipeline messages.
 * Each queue binds to the exchange with its own routing key.
 */

export interface QueueDeclaration {
  name: string;
  routingKey: string;
  options?: {
    durable?: boolean;
    autoDelete?: boolean;
    maxLength?: number;
    messageTtl?: number;
    deadLetterExchange?: string;
    deadLetterRoutingKey?: string;
  };
}

export interface ExchangeDeclaration {
  name: string;
  type: 'direct' | 'topic' | 'fanout' | 'headers';
  options?: {
    durable?: boolean;
    autoDelete?: boolean;
  };
}

export const STAS_EXCHANGE: ExchangeDeclaration = {
  name: 'stas',
  type: 'direct',
  options: { durable: true },
};

export const AGENT_QUEUES: QueueDeclaration[] = [
  { name: 'stas.agents.triage', routingKey: 'stas.agents.triage' },
  { name: 'stas.agents.dispatch', routingKey: 'stas.agents.dispatch' },
  { name: 'stas.agents.sandbox', routingKey: 'stas.agents.sandbox' },
  { name: 'stas.agents.verification', routingKey: 'stas.agents.verification' },
  { name: 'stas.agents.pr_creation', routingKey: 'stas.agents.pr_creation' },
  { name: 'stas.agents.notifications', routingKey: 'stas.agents.notifications' },
  { name: 'stas.agents.default', routingKey: 'stas.agents.default' },
];

export const QUALITY_QUEUES: QueueDeclaration[] = [
  { name: 'stas.quality', routingKey: 'stas.quality' },
];

export const ALL_QUEUES: QueueDeclaration[] = [...AGENT_QUEUES, ...QUALITY_QUEUES];

export const QUEUE_ROUTING: Record<string, string> = {
  'workers.quality.analyzer.quality_analyze': 'stas.quality',
  'workers.quality.anti_mockup_scan.anti_mockup_scan': 'stas.quality',
  'workers.tasks.self_audit.run_self_audit': 'stas.quality',
  'workers.tasks.self_audit.orchestrate_pipeline': 'stas.quality',
  'workers.tasks.self_audit.review_decision': 'stas.quality',
  'workers.tasks.triage.triage_issue': 'stas.agents.triage',
  'workers.tasks.agent.dispatch_opencode': 'stas.agents.dispatch',
  'workers.tasks.sandbox.boot_sandbox': 'stas.agents.sandbox',
  'workers.tasks.verification.run_verification': 'stas.agents.verification',
  'workers.tasks.pr_creation.create_pull_request': 'stas.agents.pr_creation',
  'workers.tasks.notifications.send_notification': 'stas.agents.notifications',
};

export interface RabbitMQConfig {
  exchange: ExchangeDeclaration;
  queues: QueueDeclaration[];
  routing: Record<string, string>;
}

export function getRabbitMQConfig(): RabbitMQConfig {
  return {
    exchange: STAS_EXCHANGE,
    queues: ALL_QUEUES,
    routing: QUEUE_ROUTING,
  };
}

export function getQualityQueues(): QueueDeclaration[] {
  return QUALITY_QUEUES;
}

export function isKnownQueue(name: string): boolean {
  return ALL_QUEUES.some((q) => q.name === name);
}
