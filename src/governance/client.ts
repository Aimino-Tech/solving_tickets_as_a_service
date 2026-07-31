/**
 * Governance Proxy Client — routes STAS dispatch through the governance proxy.
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

const log = rootLogger.child({ module: 'governance-client' });

export interface GovernanceDispatchResult {
  success: boolean;
  runId?: string;
  error?: string;
  /** HTTP status from governance proxy (e.g., 429 for rate limited, 402 for killed) */
  status?: number;
}

export interface GovernanceDispatchPayload {
  installationId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null | undefined;
  labels: string[];
  /** Optional trace ID for cross-system correlation. */
  traceId?: string;
}

/**
 * Resolve the governance proxy base URL.
 *
 * Prefers `GOVERNANCE_URL` when the proxy is enabled; falls back to
 * `PROXY_DISPATCH_URL` for backward compatibility with existing deployments.
 */
function resolveGovernanceBaseUrl(): string {
  if (config.governance.enabled && config.governance.url) return config.governance.url;
  return config.proxy.dispatchUrl || '';
}

/**
 * Dispatch an issue fix request through the governance proxy.
 *
 * The proxy applies all governance guardrails before forwarding to
 * OpenSymphony. If the proxy is unavailable, the dispatch fails closed
 * (no agent dispatch occurs without governance checks).
 */
export async function dispatchThroughGovernance(payload: GovernanceDispatchPayload): Promise<GovernanceDispatchResult> {
  const proxyUrl = resolveGovernanceBaseUrl();
  if (!proxyUrl) {
    log.warn({ traceId: payload.traceId }, 'Governance proxy not configured — dispatch through governance skipped');
    return { success: false, error: 'Governance proxy not configured', status: 0 };
  }

  const apiKey = config.proxy.apiKey;
  const traceId = payload.traceId;

  const body = {
    issue_id: `${payload.repoOwner}/${payload.repoName}#${payload.issueNumber}`,
    repo: `${payload.repoOwner}/${payload.repoName}`,
    issue_number: payload.issueNumber,
    title: payload.issueTitle,
    body: payload.issueBody,
    labels: payload.labels,
    installation_id: payload.installationId,
    source: 'stas',
    trace_id: traceId,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.governance.timeoutMs);

  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/api/stas/webhook`;
    log.info(
      { url, traceId, repo: body.repo, issueNumber: payload.issueNumber },
      'Dispatching through governance proxy',
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        'X-Governance-Source': 'stas',
        ...(traceId ? { 'x-trace-id': traceId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const status = response.status;

    if (status === 429) {
      const text = await response.text().catch(() => 'Rate limited');
      log.warn({ status, traceId, body: text }, 'Governance proxy rate limited the request');
      return { success: false, error: `Rate limited: ${text}`, status };
    }

    if (status === 402 || status === 503) {
      const text = await response.text().catch(() => 'Tenant killed');
      log.warn({ status, traceId, body: text }, 'Governance proxy rejected — kill-switch active');
      return { success: false, error: `Tenant killed: ${text}`, status };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      log.error({ status, traceId, body: text }, 'Governance proxy dispatch failed');
      return { success: false, error: `HTTP ${status}: ${text}`, status };
    }

    const result = (await response.json()) as Record<string, unknown>;
    log.info({ runId: result.run_id, status, traceId }, 'Governance proxy dispatch succeeded');

    return {
      success: true,
      runId: String(result.run_id || ''),
      status,
    };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    log.error({ traceId, err: String(err), timedOut }, 'Governance proxy request failed — fail-closed');
    return {
      success: false,
      error: timedOut
        ? `Governance proxy timeout after ${config.governance.timeoutMs}ms`
        : `Governance proxy unreachable: ${String(err)}`,
      status: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if the governance proxy is healthy and reachable.
 */
export async function checkGovernanceHealth(): Promise<{
  healthy: boolean;
  status: string;
}> {
  const proxyUrl = resolveGovernanceBaseUrl();
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
