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
  const base = config.osy?.dispatchUrl ?? process.env.OS_DISPATCH_URL;
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
      headers['x-stas-trace-id'] = payload.traceId;
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

    const result = (await response.json()) as { run_id?: string };
    log.info({ runId: result.run_id }, 'OS dispatch succeeded');
    return { success: true, runId: result.run_id };
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
    const statusUrl = `${baseUrl.origin}/api/v1/runs/${runId}`;
    const response = await fetch(statusUrl, {
      headers: { 'X-API-Key': config.osy?.apiKey ?? '' },
    });

    if (!response.ok) return null;
    return (await response.json()) as { status: string; prUrl?: string };
  } catch {
    return null;
  }
}
