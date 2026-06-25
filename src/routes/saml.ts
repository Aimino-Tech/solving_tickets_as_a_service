import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rootLogger } from '../utils/logger.js';
import {
  registerSamlTenant, unregisterSamlTenant, getSamlTenantConfig,
  listSamlTenants, storeSamlSession, destroySamlSession, getSamlSession, requireSaml,
} from '../middleware/saml.js';
import type { SamlTenantConfig, EnterpriseUser } from '../middleware/saml.js';

const log = rootLogger.child({ module: 'saml-api' });
const router = Router();

const samlLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});
router.use(samlLimiter);

router.use('/acs', (_req: Request, _res: Response, next) => {
  if (_req.method === 'POST') {
    let body = '';
    _req.on('data', (chunk: string) => { body += chunk; });
    _req.on('end', () => {
      try { (_req as Record<string, unknown>).samlBody = Object.fromEntries(new URLSearchParams(body)); }
      catch { /* empty */ }
      next();
    });
  } else { next(); }
});

function getAdminKey(req: Request): string | undefined {
  return req.headers['x-admin-key'] as string | undefined;
}

router.get('/login', (req: Request, res: Response) => {
  try {
    const tenantId = (req.query.tenant as string) || (req.headers['x-saml-tenant'] as string);
    if (!tenantId) { res.status(400).json({ error: 'Missing tenant parameter' }); return; }
    const config = getSamlTenantConfig(tenantId);
    if (!config) { res.status(404).json({ error: `Unknown tenant: ${tenantId}` }); return; }
    if (!config.enabled) { res.status(403).json({ error: `SAML disabled for tenant: ${tenantId}` }); return; }
    const relayState = (req.query.relayState as string) || req.headers.referer || '/';
    const ssoUrl = new URL(config.idpSsoUrl);
    ssoUrl.searchParams.set('SAMLRequest', `_${crypto.randomBytes(16).toString('hex')}`);
    ssoUrl.searchParams.set('RelayState', relayState);
    log.info({ tenantId, relayState }, 'Redirecting to IdP for SAML SSO');
    res.redirect(302, ssoUrl.toString());
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to initiate SAML login');
    res.status(500).json({ error: 'Failed to initiate SAML login' });
  }
});

router.post('/acs', async (req: Request, res: Response) => {
  try {
    const samlBody = (req as Record<string, unknown>).samlBody as Record<string, string> | undefined;
    const samlResponse = samlBody?.SAMLResponse || req.body?.SAMLResponse;
    if (!samlResponse) { res.status(400).json({ error: 'Missing SAMLResponse' }); return; }
    let decoded: string;
    try { decoded = Buffer.from(samlResponse, 'base64').toString('utf-8'); }
    catch { res.status(400).json({ error: 'Invalid encoding' }); return; }

    const nameId = decoded.match(/<saml2:NameID[^>]*>([^<]+)<\/saml2:NameID>/)?.[1] ?? null;
    const sessionIndex = decoded.match(/SessionIndex="([^"]+)"/)?.[1] ?? null;
    const email = decoded.match(/<saml2:Attribute Name="email"[^>]*>.*?<saml2:AttributeValue[^>]*>([^<]+)<\/saml2:AttributeValue>/s)?.[1] ?? null;
    const issuer = decoded.match(/<saml2:Issuer[^>]*>([^<]+)<\/saml2:Issuer>/)?.[1] ?? '';

    const tenantConfig = listSamlTenants().find((t) => t.idpIssuer === issuer);
    if (!tenantConfig) { res.status(401).json({ error: 'Unknown identity provider' }); return; }
    if (!nameId) { res.status(400).json({ error: 'Missing NameID' }); return; }

    const sessionToken = `saml-${crypto.randomBytes(32).toString('hex')}`;
    storeSamlSession(sessionToken, { nameId, tenantId: tenantConfig.tenantId, email, sessionIndex, attributes: {}, createdAt: new Date() });

    log.info({ tenantId: tenantConfig.tenantId, nameId, email }, 'SAML SSO successful');
    const relayState = (samlBody?.RelayState as string) || '/';
    res.cookie('stas_saml_token', sessionToken, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 86_400_000 });
    res.json({ success: true, sessionToken, tenantId: tenantConfig.tenantId, tenantName: tenantConfig.tenantName, nameId, email, redirectTo: relayState });
  } catch (err) {
    log.error({ err: String(err) }, 'SAML ACS failed');
    res.status(500).json({ error: 'Failed to process SAML assertion' });
  }
});

router.get('/metadata', (req: Request, res: Response) => {
  const tenantId = req.query.tenant as string;
  if (!tenantId) { res.status(400).json({ error: 'Missing tenant' }); return; }
  const config = getSamlTenantConfig(tenantId);
  if (!config) { res.status(404).json({ error: `Unknown tenant: ${tenantId}` }); return; }
  const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${e(config.spEntityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${e(config.spAcsUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  res.setHeader('Content-Type', 'application/samlmetadata+xml');
  res.send(xml);
});

router.post('/slo', (req: Request, res: Response) => {
  try {
    let token: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer saml-')) { token = auth.slice(11); }
    else {
      const cookies = req.headers.cookie;
      if (cookies) {
        for (const part of cookies.split(';')) {
          const eq = part.indexOf('=');
          if (eq !== -1 && part.slice(0, eq).trim() === 'stas_saml_token') { token = part.slice(eq + 1).trim(); break; }
        }
      }
    }
    if (!token) { res.json({ success: true, message: 'No active session' }); return; }
    const session = getSamlSession(token);
    destroySamlSession(token);
    res.clearCookie('stas_saml_token');
    log.info({ tenantId: session?.tenantId, nameId: session?.nameId }, 'SAML SLO');
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { log.error({ err: String(err) }, 'SAML SLO failed'); res.status(500).json({ error: 'SLO failed' }); }
});

router.get('/session', requireSaml, (req: Request, res: Response) => {
  const user = req.samlUser as EnterpriseUser;
  const tc = req.samlTenant || getSamlTenantConfig(user.tenantId);
  res.json({ authenticated: true, tenantId: user.tenantId, tenantName: tc?.tenantName || user.tenantId, nameId: user.nameId, email: user.email });
});

router.get('/tenants', (req: Request, res: Response) => {
  if (!getAdminKey(req) || getAdminKey(req) !== process.env.ADMIN_API_KEY) { res.status(403).json({ error: 'Admin key required' }); return; }
  res.json({ tenants: listSamlTenants().map((t) => ({ tenantId: t.tenantId, tenantName: t.tenantName, idpIssuer: t.idpIssuer, spEntityId: t.spEntityId, spAcsUrl: t.spAcsUrl, enabled: t.enabled })) });
});

router.post('/tenants', (req: Request, res: Response) => {
  if (!getAdminKey(req) || getAdminKey(req) !== process.env.ADMIN_API_KEY) { res.status(403).json({ error: 'Admin key required' }); return; }
  const b = req.body as { tenantId: string; tenantName: string; idpIssuer: string; idpSsoUrl: string; idpCert: string; spEntityId?: string; spAcsUrl?: string; enabled?: boolean };
  if (!b.tenantId || !b.tenantName || !b.idpIssuer || !b.idpSsoUrl || !b.idpCert) { res.status(400).json({ error: 'Missing required fields' }); return; }
  registerSamlTenant({ tenantId: b.tenantId, tenantName: b.tenantName, idpIssuer: b.idpIssuer, idpSsoUrl: b.idpSsoUrl, idpCert: b.idpCert, spEntityId: b.spEntityId || `${b.tenantId}.stas.dev`, spAcsUrl: b.spAcsUrl || '/api/v1/saml/acs', enabled: b.enabled ?? true });
  res.status(201).json({ success: true });
});

router.delete('/tenants/:tenantId', (req: Request, res: Response) => {
  if (!getAdminKey(req) || getAdminKey(req) !== process.env.ADMIN_API_KEY) { res.status(403).json({ error: 'Admin key required' }); return; }
  const { tenantId } = req.params;
  if (!getSamlTenantConfig(tenantId)) { res.status(404).json({ error: `Unknown tenant: ${tenantId}` }); return; }
  unregisterSamlTenant(tenantId);
  res.json({ success: true, tenantId });
});

export { router as samlRouter };
