/**
 * Issue job queue — publishes jobs to RabbitMQ for Celery workers.
 *
 * Simplified after BullMQ → RabbitMQ migration. All jobs are now published
 * directly to RabbitMQ via producers.ts. The Node.js process no longer
 * runs a BullMQ worker — Celery (Python) handles job processing.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ RabbitMQ publish failures logged with structured context
 * ✅ Sentry breadcrumbs for enqueue events
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from "../config.js";
import type { IssueJobData } from "../utils/types.js";
import { rootLogger } from "../utils/logger.js";
import { addBreadcrumb } from "../monitoring/sentry.js";
import { enabledFor } from "../services/featureFlags.js";

const log = rootLogger.child({ module: 'issue-queue' });

export async function enqueueIssue(
  _queue: undefined,
  data: IssueJobData,
): Promise<string | undefined> {
  const repo = `${data.repoOwner}/${data.repoName}`;

  const useRabbitmq = await enabledFor('rabbitmq_backend', data.installationId);
  const effectiveBackend = useRabbitmq ? 'rabbitmq' : 'fallback';

  addBreadcrumb('queue', 'Enqueueing issue', {
    repo,
    issueNumber: String(data.issueNumber),
    installationId: String(data.installationId),
    backend: effectiveBackend,
  });

  if (!useRabbitmq) {
    log.warn(
      { repo, issueNumber: data.issueNumber },
      'RabbitMQ backend disabled via feature flag, using fallback',
    );
  }

  try {
    const { publishFixJob } = await import('./producers.js');
    const published = await publishFixJob(data);

    if (published) {
      log.info(
        { repo, issueNumber: data.issueNumber },
        'Issue published to RabbitMQ',
      );
      return effectiveBackend;
    }

    log.warn(
      { repo, issueNumber: data.issueNumber },
      'Failed to publish issue — publish returned false',
    );
    return undefined;
  } catch (err) {
    log.error(
      {
        err: String(err),
        repo,
        issueNumber: data.issueNumber,
      },
      'Failed to enqueue issue',
    );
    return undefined;
  }
}
