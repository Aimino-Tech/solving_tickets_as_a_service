import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';

const log = rootLogger.child({ module: 'celery-dispatcher' });

interface CeleryMessage {
  task: string;
  id: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
  retries: number;
  eta?: string;
  expires?: string;
}

function buildCeleryMessage(
  taskName: string,
  kwargs: Record<string, unknown>,
  delaySeconds?: number,
  deterministicId?: string,
): CeleryMessage {
  const msg: CeleryMessage = {
    task: taskName,
    id: deterministicId ?? randomUUID(),
    args: [],
    kwargs,
    retries: 0,
  };
  if (delaySeconds && delaySeconds > 0) {
    msg.eta = new Date(Date.now() + delaySeconds * 1000).toISOString();
  }
  return msg;
}

async function publishToQueue(
  exchange: string,
  routingKey: string,
  message: CeleryMessage,
): Promise<boolean> {
  try {
    const { publishMessage, connect: rmqConnect, isConnected } = await import('../queue/rabbitmq.js');
    if (!isConnected()) {
      await rmqConnect();
    }
    await publishMessage(exchange, routingKey, message);
    log.info({ task: message.task, id: message.id }, 'Celery task published');
    return true;
  } catch (err) {
    log.error({ err: String(err), task: message.task }, 'Failed to publish Celery task');
    return false;
  }
}

export async function dispatchToCeleryPipeline(data: IssueJobData): Promise<{
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}> {
  const issueId = data.trackerTicketId || `gh-${data.repoOwner}-${data.repoName}-${data.issueNumber}`;
  const source = data.source ?? 'github';
  const runId = `${source}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`;
  const dedupId = `${source}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`;

  log.info({ runId, issueId, repo: `${data.repoOwner}/${data.repoName}` }, 'Dispatching to Celery pipeline');

  const ctx: Record<string, unknown> = {
    issue_id: issueId,
    issue_identifier: data.trackerTicketId || `gh-${data.issueNumber}`,
    repo_owner: data.repoOwner,
    repo_name: data.repoName,
    repo_private: data.repoPrivate,
    issue_number: data.issueNumber,
    issue_title: data.issueTitle,
    issue_description: data.issueBody || '',
    issue_body: data.issueBody || '',
    title: data.issueTitle,
    body: data.issueBody || '',
    labels: data.labels || [],
    source: data.source || 'github',
    installation_id: data.installationId,
    current_state: 'Todo',
    run_id: dedupId,
  };

  const msg = buildCeleryMessage('workers.tasks.triage.classify_issue', ctx, undefined, dedupId);
  const published = await publishToQueue('stas.direct', 'issue.fix', msg);

  if (!published) {
    return {
      success: false,
      errors: ['Failed to dispatch to Celery pipeline — RabbitMQ unavailable'],
    };
  }

  return {
    success: true,
    runId: dedupId,
    summary: `Dispatched to Celery pipeline: triage → agent → verification → PR`,
  };
}

export async function dispatchFullPipeline(data: IssueJobData): Promise<{
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}> {
  const issueId = data.trackerTicketId || `gh-${data.repoOwner}-${data.repoName}-${data.issueNumber}`;
  const source = data.source ?? 'github';
  const dedupId = `${source}:${data.repoOwner}/${data.repoName}#${data.issueNumber}`;

  log.info({ runId: dedupId, issueId, repo: `${data.repoOwner}/${data.repoName}` }, 'Dispatching full pipeline');

  const ctx: Record<string, unknown> = {
    issue_id: issueId,
    issue_identifier: data.trackerTicketId || `gh-${data.issueNumber}`,
    repo_owner: data.repoOwner,
    repo_name: data.repoName,
    issue_number: data.issueNumber,
    issue_title: data.issueTitle,
    issue_description: data.issueBody || '',
    title: data.issueTitle,
    body: data.issueBody || '',
    labels: data.labels || [],
    source: data.source || 'github',
    installation_id: data.installationId,
    current_state: 'Todo',
    run_id: dedupId,
  };

  const msg = buildCeleryMessage('workers.tasks.pipeline_orchestrator.run_full_pipeline', ctx, undefined, dedupId);
  const published = await publishToQueue('stas.direct', 'issue.fix', msg);

  if (!published) {
    return {
      success: false,
      errors: ['Failed to dispatch full pipeline — RabbitMQ unavailable'],
    };
  }

  return {
    success: true,
    runId: dedupId,
    summary: 'Dispatched to Celery full pipeline orchestrator',
  };
}
