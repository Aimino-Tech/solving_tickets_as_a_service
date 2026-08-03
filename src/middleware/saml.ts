import type { Request, Response, NextFunction } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'saml-middleware' });

export interface EnterpriseUser {
  tenantId: string;
  tenantName: string;
  nameId: string;
  email: string | null;
  sessionIndex: string | null;
  attributes: Record<string, string[]>;
}

export interface SamlTenantConfig {
  tenantId: string;
  tenantName: string;
  idpIssuer: string;
  idpSsoUrl: string;
  idpSloUrl?: string;
  idpCert: string;
  spEntityId: string;
  spAcsUrl: string;
  enabled: boolean;
}

declare global {
  namespace Express {
    interface Request {
      samlUser?: EnterpriseUser;
      samlTenant?: SamlTenantConfig;
    }
  }
}

const tenantRegistry = new Map<string, SamlTenantConfig>();

export function registerSamlTenant(config: SamlTenantConfig): void {
  tenantRegistry.set(config.tenantId, config);
  log.info({ tenantId: config.tenantId, idpIssuer: config.idpIssuer }, 'Registered SAML tenant');
}

export function unregisterSamlTenant(tenantId: string): void {
  tenantRegistry.delete(tenantId);
  log.info({ tenantId }, 'Unregistered SAML tenant');
}

export function getSamlTenantConfig(tenantId: string): SamlTenantConfig | undefined {
  return tenantRegistry.get(tenantId);
}

export function listSamlTenants(): SamlTenantConfig[] {
  return Array.from(tenantRegistry.values());
}

interface SamlSession {
  nameId: string;
  tenantId: string;
  email: string | null;
  sessionIndex: string | null;
  attributes: Record<string, string[]>;
  createdAt: Date;
}

const activeSessions = new Map<string, SamlSession>();

export function storeSamlSession(
  sessionToken: string, session: SamlSession, ttlMs: number = 86_400_000,
): void {
  activeSessions.set(sessionToken, session);
  setTimeout(() => { activeSessions.delete(sessionToken); }, ttlMs);
}

export function getSamlSession(sessionToken: string): SamlSession | undefined {
  return activeSessions.get(sessionToken);
}

export function destroySamlSession(sessionToken: string): void {
  activeSessions.delete(sessionToken);
}

function resolveTenantId(req: Request): string | undefined {
  return req.headers['x-saml-tenant'] as string | undefined
    || req.query.tenant as string | undefined;
}

function resolveSamlUser(req: Request): EnterpriseUser | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer saml-')) {
    const session = getSamlSession(authHeader.slice(11));
    if (session) {
      return { tenantId: session.tenantId, tenantName: '', nameId: session.nameId, email: session.email, sessionIndex: session.sessionIndex, attributes: session.attributes };
    }
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies?.['syntaro_saml_token'];
  if (cookieToken) {
    const session = getSamlSession(cookieToken);
    if (session) {
      return { tenantId: session.tenantId, tenantName: '', nameId: session.nameId, email: session.email, sessionIndex: session.sessionIndex, attributes: session.attributes };
    }
  }
  return undefined;
}

export function requireSaml(req: Request, res: Response, next: NextFunction): void {
  const tenantId = resolveTenantId(req);
  if (tenantId) {
    const c = getSamlTenantConfig(tenantId);
    if (c) req.samlTenant = c;
  }
  const user = resolveSamlUser(req);
  if (!user) {
    res.status(401).json({ error: 'SAML authentication required', tenant: req.samlTenant?.tenantId ?? null, ssoUrl: req.samlTenant?.idpSsoUrl ?? null });
    return;
  }
  req.samlUser = user;
  next();
}

export function optionalSaml(req: Request, _res: Response, next: NextFunction): void {
  const tenantId = resolveTenantId(req);
  if (tenantId) {
    const c = getSamlTenantConfig(tenantId);
    if (c) req.samlTenant = c;
  }
  const user = resolveSamlUser(req);
  if (user) req.samlUser = user;
  next();
}

function parseCookies(req: Request): Record<string, string> | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}
