import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { dispatchFullPipeline } from './celeryDispatcher.js';

const log = rootLogger.child({ module: 'os-dispatch' });

export interface DispatchResult {
  success: boolean;
  runId?: string;
  summary?: string;
  prUrl?: string;
  errors?: string[];
}

function buildPayload(data: IssueJobData, tenant: string): Record<string, unknown> {
  return {
    issue_id: data.trackerTicketId || `gh-${data.issueNumber}`,
    repo: `${data.repoOwner}/${data.repoName}`,
    tenant,
    title: data.issueTitle,
    body: data.issueBody,
    labels: data.labels,
    source: data.source || 'github',
    tracker_type: data.trackerType,
    tracker_ticket_id: data.trackerTicketId,
    installation_id: data.installationId,
  };
}

async function httpDispatch(url: string, apiKey: string | undefined, payload: Record<string, unknown>): Promise<DispatchResult> {
  try {
    log.info({ url, hasApiKey: !!apiKey }, 'HTTP dispatch');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      log.error({ status: response.status, error: errorText }, 'HTTP dispatch failed');
      return { success: false, errors: [`HTTP ${response.status}: ${errorText}`] };
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ runId: result.run_id, prUrl: result.pr_url }, 'HTTP dispatch accepted');

    return {
      success: true,
      runId: String(result.run_id || ''),
      summary: String(result.summary || 'Dispatched'),
      prUrl: result.pr_url ? String(result.pr_url) : undefined,
    };
  } catch (err) {
    log.error({ err: String(err) }, 'HTTP dispatch error');
    return { success: false, errors: [String(err)] };
  }
}

export async function dispatchToOpenSymphony(data: IssueJobData): Promise<DispatchResult> {
  const tenant = config.opensymphony?.tenant || 'default';

  const celeryEnabled = config.opensymphony?.celeryPipeline?.enabled === true;
  if (celeryEnabled) {
    const result = await dispatchFullPipeline(data);
    if (result.success) return result;
    log.warn('Celery dispatch failed, falling back to HTTP dispatch');
  }

  const governanceUrl = config.osy?.dispatchUrl;
  if (governanceUrl) {
    log.info({ governanceUrl, tenant }, 'Routing dispatch through governance proxy');
    const payload = buildPayload(data, tenant);
    const result = await httpDispatch(governanceUrl, config.osy?.apiKey, payload);
    if (result.success) return result;
    log.warn({ error: result.errors }, 'Governance proxy dispatch failed, falling back to direct');
  }

  const osUrl = config.opensymphony?.dispatchUrl;
  if (!osUrl) {
    log.error('No dispatch target available');
    return { success: false, errors: ['No dispatch target available'] };
  }

  const payload = buildPayload(data, tenant);
  return httpDispatch(osUrl, config.opensymphony?.apiKey, payload);
}
