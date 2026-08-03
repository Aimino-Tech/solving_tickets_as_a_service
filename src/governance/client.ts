/**
 * Governance Proxy Client — routes SYNTARO dispatch through the governance proxy.
 *
 * The governance proxy applies rate limiting, model routing, kill-switch,
 * prompt injection detection, token budget tracking, and audit logging
 * before forwarding to OpenSymphony.
 *
 * ── Usage ──────────────────────────────────────────────────────────────
 *   import { dispatchThroughGovernance } from './governance/client.js';
 *
 *   const result = await dispatchThroughGovernance({
 *     installationId: 123,
 *     repoOwner: 'owner',
 *     repoName: 'repo',
 *     issueNumber: 42,
 *     issueTitle: 'Fix login bug',
 *     issueBody: '...',
 *     labels: ['bug'],
 *   });
 * ────────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { TRACE_HEADER } from '../utils/trace.js';

const log = rootLogger.child({ module: 'governance-client' });

export interface GovernanceDispatchResult {
  success: boolean;
  runId?: string;
  error?: string;
  /** HTTP status from governance proxy (429 rate limited, 402/503 killed, 0 unreachable/disabled) */
  status?: number;
  /** True when governance is disabled by config and no request was made. */
  disabled?: boolean;
}

export interface GovernanceDispatchPayload {
  installationId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null | undefined;
  labels: string[];
  /** Trace ID propagated as `x-trace-id` header and `trace_id` body field. */
  traceId?: string;
}

export function isGovernanceEnabled(): boolean {
  return Boolean(config.governance?.enabled) && Boolean(config.governance?.url);
}

/**
 * Dispatch an issue fix request through the governance proxy.
 *
 * The proxy applies all governance guardrails before forwarding to
 * OpenSymphony. If the proxy is unavailable, the dispatch fails closed
 * (no agent dispatch occurs without governance checks).
 */
export async function dispatchThroughGovernance(payload: GovernanceDispatchPayload): Promise<GovernanceDispatchResult> {
  const { traceId } = payload;
  const base = { traceId } as Record<string, unknown>;
  if (!isGovernanceEnabled()) {
    log.info({ ...base }, 'Governance proxy disabled — caller should use direct dispatch');
    return { success: false, error: 'Governance proxy disabled', status: 0, disabled: true };
  }

  const proxyUrl = config.governance.url as string;
  const apiKey = config.governance.apiKey;
  const timeoutMs = config.governance.timeoutMs;

  const body = {
    issue_id: `${payload.repoOwner}/${payload.repoName}#${payload.issueNumber}`,
    repo: `${payload.repoOwner}/${payload.repoName}`,
    issue_number: payload.issueNumber,
    title: payload.issueTitle,
    body: payload.issueBody,
    labels: payload.labels,
    installation_id: payload.installationId,
    source: 'syntaro',
    trace_id: traceId,
  };

  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/api/syntaro/webhook`;
    log.info(
      { ...base, url, repo: body.repo, issueNumber: payload.issueNumber },
      'Dispatching through governance proxy',
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Governance-Source': 'syntaro',
    };
    if (apiKey) headers['X-API-Key'] = apiKey;
    if (traceId) {
      headers[TRACE_HEADER] = traceId;
      headers['x-trace-id'] = traceId;
      headers.traceparent = `00-${traceId.replace(/-/g, '')}-${traceId.slice(0, 16)}-01`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const status = response.status;

    if (status === 429) {
      const text = await response.text().catch(() => 'Rate limited');
      log.warn({ ...base, status, body: text }, 'Governance proxy rate limited the request');
      return { success: false, error: `Rate limited: ${text}`, status };
    }

    if (status === 402 || status === 503) {
      const text = await response.text().catch(() => 'Kill-switch');
      log.warn({ ...base, status, body: text }, 'Governance proxy rejected — kill-switch active');
      return { success: false, error: `Kill-switch: ${text}`, status };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      log.error({ ...base, status, body: text }, 'Governance proxy dispatch failed');
      return { success: false, error: `HTTP ${status}: ${text}`, status };
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ ...base, runId: result.run_id, status }, 'Governance proxy dispatch succeeded');

    return {
      success: true,
      runId: String(result.run_id || ''),
      status,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    log.error(
      { ...base, err: String(err) },
      isTimeout ? 'Governance proxy timed out — fail-closed' : 'Governance proxy request failed — fail-closed',
    );
    return {
      success: false,
      error: isTimeout
        ? `Governance proxy timeout after ${timeoutMs}ms`
        : `Governance proxy unreachable: ${String(err)}`,
      status: 0,
    };
  }
}

/**
 * Check if the governance proxy is healthy and reachable.
 */
export async function checkGovernanceHealth(): Promise<{
  healthy: boolean;
  status: string;
}> {
  const proxyUrl = config.governance.url;
  if (!proxyUrl) {
    return { healthy: false, status: 'not_configured' };
  }

  try {
    const baseUrl = new URL(proxyUrl);
    const healthUrl = `${baseUrl.origin}/guardrail/health`;
    const response = await fetch(healthUrl, { method: 'GET' });

    if (response.ok) {
      return { healthy: true, status: 'ok' };
    }
    return { healthy: false, status: `HTTP ${response.status}` };
  } catch (err) {
    log.warn({ err: String(err) }, 'Governance proxy health check failed');
    return { healthy: false, status: 'unreachable' };
  }
}
