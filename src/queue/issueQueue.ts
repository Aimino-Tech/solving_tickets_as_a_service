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

const log = rootLogger.child({ module: 'issue-queue' });

/**
 * Enqueue an issue for processing via RabbitMQ.
 *
 * @param data - The issue job data to enqueue
 * @returns "rabbitmq" on success, undefined on failure
 */
export async function enqueueIssue(
  _queue: undefined,
  data: IssueJobData,
): Promise<string | undefined> {
  const repo = `${data.repoOwner}/${data.repoName}`;

  addBreadcrumb('queue', 'Enqueueing issue via RabbitMQ', {
    repo,
    issueNumber: String(data.issueNumber),
    installationId: String(data.installationId),
    backend: config.queue.backend,
  });

  try {
    const { publishFixJob } = await import('./producers.js');
    const published = await publishFixJob(data);

    if (published) {
      log.info(
        { repo, issueNumber: data.issueNumber },
        'Issue published to RabbitMQ',
      );
      return 'rabbitmq';
    }

    log.warn(
      { repo, issueNumber: data.issueNumber },
      'Failed to publish issue to RabbitMQ — publish returned false',
    );
    return undefined;
  } catch (err) {
    log.error(
      {
        err: String(err),
        repo,
        issueNumber: data.issueNumber,
      },
      'Failed to enqueue issue via RabbitMQ',
    );
    return undefined;
  }
}
