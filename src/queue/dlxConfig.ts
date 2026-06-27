import { config } from '../config.js';

export interface QueueDeclaration {
  name: string;
  exchange: string;
  routingKey: string;
  dlqName: string;
  dlx: string;
  retryDelayMs: number[];
  maxRetries: number;
}

const DLQ_MAX_RETRIES = Number(process.env.DLQ_MAX_RETRIES) || 5;
const DLQ_RETENTION_HOURS = Number(process.env.DLQ_RETENTION_HOURS) || 168;

export const DLQ_RETENTION_MS = DLQ_RETENTION_HOURS * 60 * 60 * 1000;

function buildQueueDeclarations(): QueueDeclaration[] {
  const defaultRetryDelays = config.queue.retryDelays;

  return [
    {
      name: 'stas.issues.fix',
      exchange: 'stas.issues',
      routingKey: 'stas.issues.fix',
      dlqName: 'stas.issues.fix.dlq',
      dlx: 'stas.dlx',
      retryDelayMs: defaultRetryDelays,
      maxRetries: DLQ_MAX_RETRIES,
    },
    {
      name: 'stas.agents.triage',
      exchange: 'stas.agents',
      routingKey: 'stas.agents.triage',
      dlqName: 'stas.agents.triage.dlq',
      dlx: 'stas.dlx',
      retryDelayMs: [5000, 30000, 120000, 300000, 1800000],
      maxRetries: DLQ_MAX_RETRIES,
    },
    {
      name: 'stas.agents.dispatch',
      exchange: 'stas.agents',
      routingKey: 'stas.agents.dispatch',
      dlqName: 'stas.agents.dispatch.dlq',
      dlx: 'stas.dlx',
      retryDelayMs: [5000, 30000, 120000],
      maxRetries: 3,
    },
    {
      name: 'stas.agents.sandbox',
      exchange: 'stas.agents',
      routingKey: 'stas.agents.sandbox',
      dlqName: 'stas.agents.sandbox.dlq',
      dlx: 'stas.dlx',
      retryDelayMs: [5000, 30000, 120000, 300000],
      maxRetries: DLQ_MAX_RETRIES,
    },
    {
      name: 'stas.agents.verification',
      exchange: 'stas.agents',
      routingKey: 'stas.agents.verification',
      dlqName: 'stas.agents.verification.dlq',
      dlx: 'stas.dlx',
      retryDelayMs: [5000, 30000, 120000],
      maxRetries: 3,
    },
  ];
}

export const QUEUE_DECLARATIONS: QueueDeclaration[] = buildQueueDeclarations();

export function getQueueDeclaration(name: string): QueueDeclaration | undefined {
  return QUEUE_DECLARATIONS.find((q) => q.name === name);
}

export function retryDelayForAttempt(attempt: number, queueName: string): number {
  const decl = getQueueDeclaration(queueName);
  if (!decl) return 30000;
  const index = Math.min(attempt, decl.retryDelayMs.length - 1);
  return decl.retryDelayMs[index] ?? 30000;
}
