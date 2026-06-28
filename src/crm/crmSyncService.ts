import { Queue, Worker } from 'bullmq';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { createOrUpdateContact, sendEvent, deleteContact } from './loopsApi.js';
import type { CrmSyncJobData, CrmSyncResult, LoopsWebhookPayload } from './types.js';

const log = rootLogger.child({ module: 'crm-sync-service' });

const CRM_SYNC_QUEUE = 'stas-crm-sync';

function redisConnection() {
  return {
    url: config.queue.redisUrl || 'redis://localhost:6379',
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

export function createCrmSyncQueue(): Queue<CrmSyncJobData> {
  const queue = new Queue<CrmSyncJobData>(CRM_SYNC_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  log.info('CRM sync queue created');
  return queue;
}

export function createCrmSyncWorker(): Worker<CrmSyncJobData> {
  const worker = new Worker<CrmSyncJobData>(
    CRM_SYNC_QUEUE,
    async (job) => {
      const data = job.data;

      switch (data.type) {
        case 'sync-contacts':
          return await handleSyncContacts(data);
        case 'sync-events':
          return await handleSyncEvents(data);
        case 'sync-contact-update':
          return await handleContactUpdate(data);
        case 'webhook-process':
          return await handleWebhookProcess(data);
        default:
          log.warn({ type: data.type }, 'Unknown CRM sync job type');
          return { status: 'failed', recordsProcessed: 0, recordsFailed: 0, errors: ['Unknown job type'], timestamp: new Date().toISOString() } satisfies CrmSyncResult;
      }
    },
    {
      connection: redisConnection(),
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, type: job.data.type }, 'CRM sync job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err: String(err) }, 'CRM sync job failed');
  });

  return worker;
}

async function handleSyncContacts(_data: CrmSyncJobData): Promise<CrmSyncResult> {
  log.info('Full contact sync initiated');
  return {
    status: 'completed',
    recordsProcessed: 0,
    recordsFailed: 0,
    timestamp: new Date().toISOString(),
  };
}

async function handleSyncEvents(_data: CrmSyncJobData): Promise<CrmSyncResult> {
  log.info('Event sync initiated');
  return {
    status: 'completed',
    recordsProcessed: 0,
    recordsFailed: 0,
    timestamp: new Date().toISOString(),
  };
}

async function handleContactUpdate(data: CrmSyncJobData): Promise<CrmSyncResult> {
  if (!data.contact) {
    return { status: 'failed', recordsProcessed: 0, recordsFailed: 0, errors: ['No contact data'], timestamp: new Date().toISOString() };
  }

  const result = await createOrUpdateContact(data.contact);
  return {
    status: result.success ? 'completed' : 'failed',
    recordsProcessed: result.success ? 1 : 0,
    recordsFailed: result.success ? 0 : 1,
    timestamp: new Date().toISOString(),
  };
}

async function handleWebhookProcess(data: CrmSyncJobData): Promise<CrmSyncResult> {
  const payload = data.webhookPayload;
  if (!payload) {
    return { status: 'failed', recordsProcessed: 0, recordsFailed: 0, errors: ['No webhook payload'], timestamp: new Date().toISOString() };
  }

  const eventName = payload.eventName;
  const contact = payload.contact;
  const identity = payload.contactIdentity;

  log.info({ eventName, contact: identity.email || identity.userId }, 'Processing Loops webhook');

  switch (eventName) {
    case 'contact.unsubscribed':
    case 'contact.deleted':
      log.info({ eventName, contact: identity.email }, 'Contact lifecycle event received');
      break;

    case 'contact.mailingList.subscribed':
    case 'contact.mailingList.unsubscribed':
      if (contact) {
        await createOrUpdateContact(contact);
      }
      break;

    case 'email.delivered':
    case 'email.opened':
    case 'email.clicked':
    case 'email.hardBounced':
    case 'email.softBounced':
    case 'email.spamReported':
      log.info({ eventName, email: payload.email?.id }, 'Email engagement event received');
      if (contact) {
        await createOrUpdateContact({
          ...contact,
          source: 'loops-webhook',
        });
      }
      break;

    default:
      log.debug({ eventName }, 'Unhandled Loops webhook event');
  }

  return {
    status: 'completed',
    recordsProcessed: 1,
    recordsFailed: 0,
    timestamp: new Date().toISOString(),
  };
}

export function enqueueCrmSync(queue: Queue<CrmSyncJobData>, data: CrmSyncJobData): Promise<string | undefined> {
  return queue.add(data.type, data, {
    deduplication: {
      id: `${data.type}:${data.timestamp}`,
      ttl: 60000,
    },
  }).then(job => job.id).catch(err => {
    log.error({ err: String(err) }, 'Failed to enqueue CRM sync job');
    return undefined;
  });
}

export function enqueueWebhookEvent(queue: Queue<CrmSyncJobData>, payload: LoopsWebhookPayload): Promise<string | undefined> {
  return enqueueCrmSync(queue, {
    type: 'webhook-process',
    webhookPayload: payload,
    timestamp: new Date().toISOString(),
  });
}
