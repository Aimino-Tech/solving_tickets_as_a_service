import { config } from '../config.js';
import type { AccountTier, TaskComplexity } from '../proxy/modelRouter.js';
import { modelRouter } from '../proxy/modelRouter.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'osy-dispatch' });

export interface DispatchResult {
  success: boolean;
  runId?: string;
  error?: string;
}

export interface IssueDispatchPayload {
  installationId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null | undefined;
  labels: string[];
  /** Optional trace ID for cross-system log correlation. */
  traceId?: string;
  /** Account tier for model routing (two-phase Haiku/Sonnet model). */
  accountTier?: AccountTier;
  /** Task complexity for model routing. */
  complexity?: TaskComplexity;
}

function getDispatchUrl(): string | undefined {
  const base = config.osy?.dispatchUrl || process.env.OS_DISPATCH_URL;
  // Empty-string config values (e.g. OSY_DISPATCH_URL=) must not shadow the
  // real OS_DISPATCH_URL fallback — `||` treats '' as unset.
  return base || undefined;
}

export async function dispatchIssueToOsy(payload: IssueDispatchPayload): Promise<DispatchResult> {
  const url = getDispatchUrl();
  if (!url) {
    log.warn('OS_DISPATCH_URL not configured — falling back to local pipeline');
    return { success: false, error: 'OS_DISPATCH_URL not configured' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': config.osy?.apiKey ?? '',
    };
    if (payload.traceId) {
      headers['x-syntaro-trace-id'] = payload.traceId;
      headers.traceparent = `00-${payload.traceId.replace(/-/g, '')}-${payload.traceId.slice(0, 16)}-01`;
    }
    let model: string | undefined;
    if (config.proxy?.modelRouterEnabled) {
      try {
        const selection = await modelRouter.selectModel({
          complexity: payload.complexity ?? 'fix',
          accountTier: payload.accountTier ?? 'free',
        });
        model = selection.model;
      } catch (err) {
        log.warn({ err: String(err) }, 'Model router selection failed — using default model');
      }
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        issue_id: `${payload.repoOwner}/${payload.repoName}#${payload.issueNumber}`,
        repo: `${payload.repoOwner}/${payload.repoName}`,
        issue_number: payload.issueNumber,
        title: payload.issueTitle,
        body: payload.issueBody,
        labels: payload.labels,
        installation_id: payload.installationId,
        model,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, 'OS dispatch failed');
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    // OpenSymphony dispatch responses use dispatch_id (older backends: run_id)
    const result = (await response.json()) as { run_id?: string; dispatch_id?: string };
    const runId = result.run_id ?? result.dispatch_id;
    log.info({ runId }, 'OS dispatch succeeded');
    return { success: true, runId };
  } catch (err) {
    log.error({ err: String(err) }, 'OS dispatch request failed');
    return { success: false, error: String(err) };
  }
}

export async function getRunStatus(runId: string): Promise<{ status: string; prUrl?: string } | null> {
  const url = getDispatchUrl();
  if (!url) return null;

  try {
    const baseUrl = new URL(url);
    // OpenSymphony exposes run state at /api/v1/dispatch/{id}/status, not /api/v1/runs/{id}
    const statusUrl = `${baseUrl.origin}/api/v1/dispatch/${runId}/status`;
    const response = await fetch(statusUrl, {
      headers: { 'X-API-Key': config.osy?.apiKey ?? '' },
    });

    if (!response.ok) return null;
    const body = (await response.json()) as {
      state?: string;
      result?: { pr_url?: string; prUrl?: string; status?: string };
    };
    const status = body.state ?? body.result?.status;
    if (!status) return null;
    const out: { status: string; prUrl?: string } = { status };
    if (body.result?.pr_url) out.prUrl = body.result.pr_url;
    else if (body.result?.prUrl) out.prUrl = body.result.prUrl;
    return out;
  } catch {
    return null;
  }
}
