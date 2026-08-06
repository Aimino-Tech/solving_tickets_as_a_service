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

  // Fix-only usage gate: ticket creation is free/unlimited; each fix dispatch
  // consumes budget. Accounts at the monthly fix limit are not dispatched.
  if (data.installationId) {
    const { resolveAccountIdByInstallation, getFixBudgetStatus } = await import('../billing/fixBudget.js');
    const accountId = await resolveAccountIdByInstallation(data.installationId);
    if (accountId) {
      const budget = await getFixBudgetStatus(accountId);
      if (budget.exhausted) {
        log.warn(
          { accountId, used: budget.used, limit: budget.limit, repo: `${data.repoOwner}/${data.repoName}` },
          'Fix budget exhausted — skipping dispatch',
        );
        return {
          success: false,
          errors: [`usage_limit_reached: monthly fix limit (${budget.limit}) reached — upgrade to fix`],
        };
      }
    }
  }

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

    await recordFixUsage(data, dispatchId);

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

/**
 * Record one fix-dispatch credit against the account's usage ledger
 * (free plan = 1 credit per fix dispatch). Account is resolved from the
 * installation id; silently skips when no matching account exists.
 */
async function recordFixUsage(data: IssueJobData, dispatchId: string): Promise<void> {
  try {
    const { queryWithRetry } = await import('../db/connection.js');
    const { usageRepository } = await import('../db/repositories/index.js');
    const acctResult = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE github_installation_id = $1 LIMIT 1',
      [data.installationId ?? 0],
    );
    if (!acctResult.rows[0]) return;
    await usageRepository.record({
      accountId: acctResult.rows[0].id,
      issueId: data.issueNumber > 0 ? data.issueNumber : undefined,
      repo: `${data.repoOwner}/${data.repoName}`,
      action: 'fix_dispatch',
      creditsUsed: 1,
    });
    log.info({ accountId: acctResult.rows[0].id, dispatchId }, 'Recorded fix usage credit');
  } catch (usageErr) {
    log.warn({ err: String(usageErr) }, 'Failed to record usage credit');
  }
}
