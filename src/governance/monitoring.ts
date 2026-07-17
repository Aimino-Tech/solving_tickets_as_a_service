import type { Request, Response } from 'express';

const GOVERNANCE_PROXY_HEADER = 'x-governance-proxy';

export function isBehindGovernanceProxy(req: Request): boolean {
  const headerValue = req.headers?.[GOVERNANCE_PROXY_HEADER];
  if (headerValue === undefined || headerValue === null) return false;
  if (Array.isArray(headerValue)) return headerValue.some((v) => v !== undefined && v !== null);
  return true;
}

export function healthHandler(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    proxy: 'governance',
    timestamp: new Date().toISOString(),
  });
}

export function readinessHandler(_req: Request, res: Response): void {
  res.json({ status: 'ready' });
}

export interface GovernanceHealthInfo {
  healthy: boolean;
  proxy: string;
  checks: Record<string, boolean>;
}

export function formatGovernanceHealth(info: GovernanceHealthInfo): Record<string, unknown> {
  return {
    status: info.healthy ? 'healthy' : 'unhealthy',
    proxy: info.proxy,
    checks: info.checks,
    timestamp: new Date().toISOString(),
  };
}
