/**
 * Admin Steering API — authenticated proxy to the OpenSymphony Elixir admin API.
 *
 * Mounted at /api/v1/admin/steering.
 *
 * Every route requires:
 *   1. A valid dashboard JWT (Authorization: Bearer <token>) — 401 otherwise.
 *   2. An email in the ADMIN_EMAILS allowlist (env-gated) — 403 otherwise.
 *
 * Authorized requests are forwarded to the OpenSymphony admin API
 * (OS_ADMIN_API_URL) with an x-api-key credential (OS_ADMIN_API_KEY) — the
 * header expected by the OS :api_auth pipeline (ApiKeyPlug). The OS side is
 * currently wiring that pipeline (AIM-4618); until then its admin routes are
 * unauthenticated, so this proxy is the only auth boundary in front of them.
 *
 * @module routes/adminSteering
 */

import { type NextFunction, type Request, type Response, Router } from 'express';
import { logAdminAction } from '../audit/service.js';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'admin-steering' });

const OS_ADMIN_PREFIX = '/api/v1/admin';

interface OsEndpoint {
  method: 'GET' | 'POST';
  path: string;
  osPath: string;
  action: string;
  resourceType: string;
  resourceId?: string;
}

const ENDPOINTS: OsEndpoint[] = [
  {
    method: 'POST',
    path: '/tenant/:id/kill',
    osPath: '/tenant/:id/kill',
    action: 'admin.steering.tenant.kill',
    resourceType: 'tenant',
    resourceId: ':id',
  },
  {
    method: 'POST',
    path: '/tenant/:id/refund',
    osPath: '/tenant/:id/refund',
    action: 'admin.steering.tenant.refund',
    resourceType: 'tenant',
    resourceId: ':id',
  },
  {
    method: 'POST',
    path: '/emergency-pause',
    osPath: '/emergency-pause',
    action: 'admin.steering.emergency.pause',
    resourceType: 'system',
  },
  {
    method: 'POST',
    path: '/emergency-resume',
    osPath: '/emergency-resume',
    action: 'admin.steering.emergency.resume',
    resourceType: 'system',
  },
  { method: 'GET', path: '/health', osPath: '/health', action: 'admin.steering.health', resourceType: 'system' },
  {
    method: 'POST',
    path: '/maintenance/activate',
    osPath: '/maintenance/activate',
    action: 'admin.steering.maintenance.activate',
    resourceType: 'system',
  },
  {
    method: 'POST',
    path: '/maintenance/deactivate',
    osPath: '/maintenance/deactivate',
    action: 'admin.steering.maintenance.deactivate',
    resourceType: 'system',
  },
  {
    method: 'GET',
    path: '/maintenance/status',
    osPath: '/maintenance/status',
    action: 'admin.steering.maintenance.status',
    resourceType: 'system',
  },
  { method: 'GET', path: '/load', osPath: '/load', action: 'admin.steering.load', resourceType: 'system' },
  {
    method: 'GET',
    path: '/error-budget',
    osPath: '/error-budget',
    action: 'admin.steering.error-budget',
    resourceType: 'system',
  },
  { method: 'POST', path: '/backup', osPath: '/backup', action: 'admin.steering.backup.run', resourceType: 'system' },
  { method: 'GET', path: '/backups', osPath: '/backups', action: 'admin.steering.backup.list', resourceType: 'system' },
];

function requireAdminEmail(req: Request, res: Response, next: NextFunction): void {
  const adminEmails = config.adminSteering.adminEmails;
  if (adminEmails.length === 0) {
    res.status(503).json({ error: 'Admin steering not configured — ADMIN_EMAILS is empty' });
    return;
  }
  const email = req.user?.email?.toLowerCase();
  if (!email || !adminEmails.includes(email)) {
    log.warn({ email, ip: req.ip, path: req.path }, 'Forbidden admin steering attempt');
    res.status(403).json({ error: 'Forbidden — account is not an administrator' });
    return;
  }
  next();
}

async function forwardToOs(
  method: 'GET' | 'POST',
  osPath: string,
  params: Record<string, string>,
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const baseUrl = config.adminSteering.osAdminApiUrl;
  if (!baseUrl) {
    throw new SteeringError(503, 'Admin steering not configured — OS_ADMIN_API_URL is not set');
  }
  const apiKey = config.adminSteering.osAdminApiKey;
  if (!apiKey) {
    throw new SteeringError(503, 'Admin steering not configured — OS_ADMIN_API_KEY is not set');
  }

  let resolvedPath = osPath;
  for (const [key, value] of Object.entries(params)) {
    resolvedPath = resolvedPath.replace(`:${key}`, encodeURIComponent(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.adminSteering.osAdminTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}${OS_ADMIN_PREFIX}${resolvedPath}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (response.status === 401 || response.status === 403) {
      throw new SteeringError(502, `OpenSymphony admin API rejected the proxy credential (HTTP ${response.status})`);
    }
    return { status: response.status, data };
  } catch (err) {
    if (err instanceof SteeringError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new SteeringError(
      502,
      aborted
        ? 'OpenSymphony admin API timed out'
        : `Failed to reach OpenSymphony admin API: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

class SteeringError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'SteeringError';
  }
}

async function handleEndpoint(endpoint: OsEndpoint, req: Request, res: Response): Promise<void> {
  try {
    const { status, data } = await forwardToOs(
      endpoint.method,
      endpoint.osPath,
      (req.params as Record<string, string>) ?? {},
      req.body,
    );
    if (endpoint.method === 'POST') {
      const resourceId = endpoint.resourceId === ':id' ? req.params.id : endpoint.resourceId;
      try {
        await logAdminAction({
          adminId: req.user?.email ?? 'unknown',
          action: endpoint.action,
          resourceType: endpoint.resourceType,
          resourceId,
          details: { osStatus: status, body: sanitizeBody(req.body) },
          ipAddress: req.ip,
          correlationId: req.requestId,
        });
      } catch (auditErr) {
        log.warn({ err: String(auditErr), endpoint: endpoint.path }, 'Admin steering audit log failed');
      }
    }
    res.status(status).json(data);
  } catch (err) {
    const steeringError = err instanceof SteeringError ? err : new SteeringError(500, String(err));
    if (steeringError.statusCode >= 500) {
      log.error({ err: steeringError.message, endpoint: endpoint.path }, 'Admin steering forward failed');
    } else {
      log.warn({ err: steeringError.message, endpoint: endpoint.path }, 'Admin steering rejected');
    }
    res.status(steeringError.statusCode).json({ error: steeringError.message });
  }
}

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const cleaned = { ...(body as Record<string, unknown>) };
  if ('payment_intent' in cleaned) cleaned.payment_intent = '[redacted]';
  return cleaned;
}

export function createAdminSteeringRouter(): Router {
  const router: Router = Router();

  router.use(requireAuth);
  router.use(requireAdminEmail);

  for (const endpoint of ENDPOINTS) {
    router[endpoint.method.toLowerCase() as 'get' | 'post'](endpoint.path, (req, res) => {
      void handleEndpoint(endpoint, req, res);
    });
  }

  return router;
}

export const adminSteeringRouter = createAdminSteeringRouter();
