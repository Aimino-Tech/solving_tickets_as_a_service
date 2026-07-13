import { templateRegistry } from './templateRegistry.js';
import type { JobTemplate } from './types.js';

function registerDefaultTemplates(): void {
  const issueFixTemplate: JobTemplate = {
    templateId: 'issue-fix',
    queueName: 'stas.issues.fix',
    exchangeName: 'stas.direct',
    routingKey: 'issue.fix',
    priority: 5,
    retryConfig: {
      maxRetries: 4,
      retryDelaysMs: [30_000, 120_000, 300_000, 900_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 600_000,
    dedupTtl: 120,
  };

  const issueFeatureTemplate: JobTemplate = {
    templateId: 'issue-feature',
    queueName: 'stas.issues.feature',
    exchangeName: 'stas.direct',
    routingKey: 'issue.feature',
    priority: 3,
    retryConfig: {
      maxRetries: 3,
      retryDelaysMs: [30_000, 120_000, 300_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 600_000,
    dedupTtl: 120,
  };

  const issueResearchTemplate: JobTemplate = {
    templateId: 'issue-research',
    queueName: 'stas.issues.research',
    exchangeName: 'stas.direct',
    routingKey: 'issue.research',
    priority: 2,
    retryConfig: {
      maxRetries: 2,
      retryDelaysMs: [30_000, 120_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 300_000,
    dedupTtl: 120,
  };

  const webhookNotificationTemplate: JobTemplate = {
    templateId: 'webhook-notification',
    queueName: 'stas.webhooks.notifications',
    exchangeName: 'stas.topic',
    routingKey: 'webhook.notification.*',
    priority: 8,
    retryConfig: {
      maxRetries: 5,
      retryDelaysMs: [10_000, 30_000, 60_000, 300_000, 600_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 300_000,
    dedupTtl: 30,
  };

  const analyticsIngestionTemplate: JobTemplate = {
    templateId: 'analytics-ingestion',
    queueName: 'stas.analytics.ingestion',
    exchangeName: 'stas.topic',
    routingKey: 'analytics.ingestion.*',
    priority: 1,
    retryConfig: {
      maxRetries: 3,
      retryDelaysMs: [30_000, 120_000, 300_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 120_000,
    dedupTtl: 60,
  };

  const pipelineEventTemplate: JobTemplate = {
    templateId: 'pipeline-event',
    queueName: 'stas.pipeline.events',
    exchangeName: 'stas.topic',
    routingKey: 'pipeline.event.*',
    priority: 7,
    retryConfig: {
      maxRetries: 3,
      retryDelaysMs: [10_000, 30_000, 60_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 60_000,
    dedupTtl: 10,
  };

  const pipelineJobTemplate: JobTemplate = {
    templateId: 'pipeline',
    queueName: 'stas.pipeline.train',
    exchangeName: 'stas.direct',
    routingKey: 'pipeline.train',
    priority: 5,
    retryConfig: {
      maxRetries: 3,
      retryDelaysMs: [30_000, 120_000, 300_000],
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 600_000,
    dedupTtl: 120,
  };

  const templates = [
    issueFixTemplate,
    issueFeatureTemplate,
    issueResearchTemplate,
    webhookNotificationTemplate,
    analyticsIngestionTemplate,
    pipelineEventTemplate,
    pipelineJobTemplate,
  ];

  for (const tpl of templates) {
    templateRegistry.registerJobTemplate(tpl);
  }
}

export { registerDefaultTemplates };
