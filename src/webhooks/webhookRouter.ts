/**
 * Webhook router — embeds platform context into enqueued jobs.
 *
 * Provides a unified interface for routing incoming webhooks from any
 * platform (GitHub, GitLab, Bitbucket) into the job queue with the
 * correct `source` field set on the enqueued data so downstream workers
 * know which platform API to call.
 */

import type { IssueJobData } from '../utils/types.js';
import type { Platform } from '../platforms/interface.js';
import { rootLogger } from '../utils/logger.js';
import { runCommonSenseGate } from '../guardrails/commonSenseGate.js';

const log = rootLogger.child({ module: 'webhook-router' });

type EnqueueHandler = (data: IssueJobData) => Promise<string | undefined>;

/**
 * Normalised webhook event after platform-specific parsing.
 * This is the standard shape produced by every platform parser and consumed
 * by the router when enqueuing a job.
 */
export interface WebhookRouterEvent {
  /** Originating platform. */
  platform: Platform;

  /** Normalised issue data. */
  issue: {
    id: number | string;
    number: number;
    title: string;
    body: string | null;
    labels: string[];
    repoOwner: string;
    repoName: string;
    repoPrivate: boolean;
    installationId?: number | string;
  };

  /** The raw event type string from the platform (for logging / debugging). */
  rawEventType: string;
}

/**
 * Callback signature for platform handlers registered with the router.
 */
export type PlatformHandler = (event: WebhookRouterEvent) => Promise<void>;

/**
 * WebhookRouter maps platform event types to handlers and enriches
 * enqueued jobs with a `source` field for platform context.
 */
export class WebhookRouter {
  private readonly handlers = new Map<string, PlatformHandler[]>();
  private readonly enqueueHandler: EnqueueHandler;

  constructor(enqueueHandler: EnqueueHandler) {
    this.enqueueHandler = enqueueHandler;
  }

  /**
   * Register a handler for a specific platform and event type.
   *
   * @param platform  The platform (github, gitlab, bitbucket)
   * @param eventType  The event type to handle (e.g. "issues.labeled", "issue:created")
   * @param handler    The handler function
   */
  on(platform: Platform, eventType: string, handler: PlatformHandler): void {
    const key = `${platform}:${eventType}`;
    const existing = this.handlers.get(key) ?? [];
    existing.push(handler);
    this.handlers.set(key, existing);
    log.debug({ platform, eventType }, 'Registered webhook handler');
  }

  /**
   * Route an incoming event to all matching handlers.
   *
   * Runs the Common Sense Gate first — if the event's repo/issue fields are
   * hallucinated or malformed, no handler is invoked (rejected pre-pipeline).
   *
   * @param event  The normalised webhook event
   */
  async route(event: WebhookRouterEvent): Promise<void> {
    const { platform, rawEventType } = event;
    const key = `${platform}:${rawEventType}`;
    const handlers = this.handlers.get(key);

    if (!handlers || handlers.length === 0) {
      log.debug({ platform, rawEventType }, 'No handlers registered for event — skipping');
      return;
    }

    const gate = runCommonSenseGate({
      platform,
      issueNumber: event.issue.number,
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
    });
    if (!gate.passed) {
      const reasons = gate.checks.filter((c) => !c.valid).map((c) => c.error ?? c.check);
      log.warn(
        { platform, rawEventType, repo: `${event.issue.repoOwner}/${event.issue.repoName}`, reasons },
        'Common Sense Gate rejected webhook event — skipping handlers',
      );
      return;
    }

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        log.error(
          { err: String(err), platform, rawEventType },
          'Webhook handler failed',
        );
      }
    }
  }

  /**
   * Build an IssueJobData from a WebhookRouterEvent with the `source` field set.
   *
   * This is the canonical way to enqueue jobs through the router — it ensures
   * the `source` field is always populated so the worker knows which platform
   * client to use when posting comments, creating PRs, etc.
   */
  buildJobData(event: WebhookRouterEvent): IssueJobData {
    return {
      installationId: Number(event.issue.installationId ?? 0),
      repoOwner: event.issue.repoOwner,
      repoName: event.issue.repoName,
      repoPrivate: event.issue.repoPrivate,
      issueNumber: event.issue.number,
      issueTitle: event.issue.title,
      issueBody: event.issue.body,
      source: event.platform,
    };
  }

  /**
   * Enqueue a job with platform context embedded.
   *
   * @param event  The normalised webhook event
   */
  async enqueue(event: WebhookRouterEvent): Promise<void> {
    const jobData = this.buildJobData(event);

    try {
      await this.enqueueHandler(jobData);
      log.info(
        {
          platform: event.platform,
          repo: `${jobData.repoOwner}/${jobData.repoName}`,
          issueNumber: jobData.issueNumber,
          source: jobData.source,
        },
        'Enqueued job with platform context',
      );
    } catch (err) {
      log.error(
        { err: String(err), platform: event.platform, repo: `${jobData.repoOwner}/${jobData.repoName}` },
        'Failed to enqueue webhook event',
      );
      throw err;
    }
  }
}
