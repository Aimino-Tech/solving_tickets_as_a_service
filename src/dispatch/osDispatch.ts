import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { dispatchFullPipeline, dispatchToCeleryPipeline } from './celeryDispatcher.js';
import * as auditService from '../audit/service.js';

const log = rootLogger.child({ module: 'os-dispatch' });

export interface DispatchResult {
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}

export async function dispatchToOpenSymphony(data: IssueJobData): Promise<DispatchResult> {
  const celeryEnabled = config.opensymphony?.celeryPipeline?.enabled === true;

  if (celeryEnabled) {
    const result = await dispatchFullPipeline(data);
    if (result.success) {
      return result;
    }
    log.warn('Celery dispatch failed, falling back to HTTP dispatch');
  }

  const osUrl = config.opensymphony?.dispatchUrl;
  if (!osUrl) {
    log.error('OPEN_SYMPHONY_DISPATCH_URL not configured and Celery unavailable — cannot dispatch');
    return { success: false, errors: ['No dispatch target available (Celery + HTTP both unavailable)'] };
  }

  const apiKey = config.opensymphony?.apiKey;
  const tenant = config.opensymphony?.tenant || 'default';

  const payload = {
    issue_id: data.trackerTicketId || `gh-${data.issueNumber}`,
    repo_url: `${data.repoOwner}/${data.repoName}`,
    tenant,
    title: data.issueTitle,
    description: data.issueBody,
    labels: data.labels,
    source: data.source || 'github',
    tracker_type: data.trackerType,
    tracker_ticket_id: data.trackerTicketId,
    installation_id: data.installationId,
  };

  try {
    log.info({ osUrl, repo_url: payload.repo_url, tenant, hasApiKey: !!apiKey }, 'Dispatching to OpenSymphony HTTP endpoint');
    log.debug({ payload }, 'OpenSymphony dispatch payload');
    const response = await fetch(osUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      log.error({ status: response.status, error: errorText }, 'OpenSymphony HTTP dispatch failed');
      return { success: false, errors: [`HTTP ${response.status}: ${errorText}`] };
    }

    const result = (await response.json()) as Record<string, unknown>;
    const dispatchId = String(result.dispatch_id || result.run_id || '');
    log.info({ dispatchId, prUrl: result.pr_url }, 'OpenSymphony HTTP dispatch accepted');

    auditService.logFixJobEvent({
      jobId: dispatchId || `os-${data.repoOwner}-${data.repoName}-${data.issueNumber}`,
      event: 'started',
      repo: `${data.repoOwner}/${data.repoName}`,
      issueNumber: data.issueNumber,
      details: { dispatchTarget: 'opensymphony-http', dispatchId },
    });

    return {
      success: true,
      runId: dispatchId || undefined,
      summary: String(result.state || 'Dispatched to OpenSymphony'),
      prUrl: result.pr_url ? String(result.pr_url) : undefined,
    };
  } catch (err) {
    log.error({ err: String(err) }, 'OpenSymphony HTTP dispatch error');
    auditService.logFixJobEvent({
      jobId: `os-${data.repoOwner}-${data.repoName}-${data.issueNumber}`,
      event: 'failed',
      repo: `${data.repoOwner}/${data.repoName}`,
      issueNumber: data.issueNumber,
      error: String(err),
    });
    return { success: false, errors: [String(err)] };
  }
}
