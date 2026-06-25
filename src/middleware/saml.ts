import type { Request, Response, NextFunction } from 'express';
import { rootLogger } from '../utils/logger.js';
const log = rootLogger.child({ module: 'saml-middleware' });
export interface EnterpriseUser { tenantId: string; tenantName: string; nameId: string; email: string | null; sessionIndex: string | null; attributes: Record<string, string[]>; }
export interface SamlTenantConfig { tenantId: string; tenantName: string; idpIssuer: string; idpSsoUrl: string; idpSloUrl?: string; idpCert: string; spEntityId: string; spAcsUrl: string; enabled: boolean; }
declare global { namespace Express { interface Request { samlUser?: EnterpriseUser; samlTenant?: SamlTenantConfig; } } }
const tenantRegistry = new Map<string, SamlTenantConfig>();
export function registerSamlTenant(config: SamlTenantConfig): void { tenantRegistry.set(config.tenantId, config); log.info({ tenantId: config.tenantId }, 'Registered SAML tenant'); }
export function unregisterSamlTenant(tenantId: string): void { tenantRegistry.delete(tenantId); }
export function getSamlTenantConfig(tenantId: string): SamlTenantConfig | undefined { return tenantRegistry.get(tenantId); }
export function listSamlTenants(): SamlTenantConfig[] { return Array.from(tenantRegistry.values()); }
interface SamlSession { nameId: string; tenantId: string; email: string | null; sessionIndex: string | null; attributes: Record<string, string[]>; createdAt: Date; }
const sessions = new Map<string, SamlSession>();
export function storeSamlSession(tok: string, s: SamlSession, ttl = 86400000): void { sessions.set(tok, s); setTimeout(() => sessions.delete(tok), ttl); }
export function getSamlSession(tok: string): SamlSession | undefined { return sessions.get(tok); }
export function destroySamlSession(tok: string): void { sessions.delete(tok); }
function resTenant(req: Request): string | undefined { return req.headers['x-saml-tenant'] as string || req.query.tenant as string; }
function resUser(req: Request): EnterpriseUser | undefined {
  const a = req.headers.authorization;
  if (a?.startsWith('Bearer saml-')) { const s = getSamlSession(a.slice(11)); if (s) return { tenantId: s.tenantId, tenantName: '', nameId: s.nameId, email: s.email, sessionIndex: s.sessionIndex, attributes: s.attributes }; }
  const c = req.headers.cookie; if (c) { for (const p of c.split(';')) { const eq = p.indexOf('='); if (eq !== -1 && p.slice(0, eq).trim() === 'stas_saml_token') { const s = getSamlSession(p.slice(eq + 1).trim()); if (s) return { tenantId: s.tenantId, tenantName: '', nameId: s.nameId, email: s.email, sessionIndex: s.sessionIndex, attributes: s.attributes }; } } }
  return undefined;
}
export function requireSaml(req: Request, res: Response, next: NextFunction): void {
  const t = resTenant(req); if (t) { const c = getSamlTenantConfig(t); if (c) req.samlTenant = c; }
  const u = resUser(req); if (!u) { res.status(401).json({ error: 'SAML required' }); return; }
  req.samlUser = u; next();
}
export function optionalSaml(req: Request, _res: Response, next: NextFunction): void {
  const t = resTenant(req); if (t) { const c = getSamlTenantConfig(t); if (c) req.samlTenant = c; }
  const u = resUser(req); if (u) req.samlUser = u; next();
}
