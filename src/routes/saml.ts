import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { rootLogger } from '../utils/logger.js';
import { registerSamlTenant, unregisterSamlTenant, getSamlTenantConfig, listSamlTenants, storeSamlSession, destroySamlSession, getSamlSession, requireSaml } from '../middleware/saml.js';
import type { EnterpriseUser } from '../middleware/saml.js';
const log = rootLogger.child({ module: 'saml-api' });
const router = Router();
router.use(rateLimit({ windowMs: 60000, limit: 20, message: { error: 'Too many requests' } }));
function ak(req: Request): string | undefined { return req.headers['x-admin-key'] as string; }
router.get('/login', (req, res) => {
  try {
    const tid = (req.query.tenant as string) || (req.headers['x-saml-tenant'] as string);
    if (!tid) { res.status(400).json({ error: 'Missing tenant' }); return; }
    const c = getSamlTenantConfig(tid);
    if (!c) { res.status(404).json({ error: 'Unknown tenant' }); return; }
    if (!c.enabled) { res.status(403).json({ error: 'SAML disabled' }); return; }
    const u = new URL(c.idpSsoUrl); u.searchParams.set('SAMLRequest', `_${crypto.randomBytes(16).toString('hex')}`); u.searchParams.set('RelayState', (req.query.relayState as string) || '/');
    res.redirect(302, u.toString());
  } catch (err) { log.error({ err: String(err) }, 'SAML login failed'); res.status(500).json({ error: 'SAML login failed' }); }
});
router.post('/acs', async (req, res) => {
  try {
    const raw = req.body?.SAMLResponse;
    if (!raw) { res.status(400).json({ error: 'Missing SAMLResponse' }); return; }
    let d: string; try { d = Buffer.from(raw, 'base64').toString('utf-8'); } catch { res.status(400).json({ error: 'Bad encoding' }); return; }
    const nameId = d.match(/<saml2:NameID[^>]*>([^<]+)<\/saml2:NameID>/)?.[1] ?? null;
    const si = d.match(/SessionIndex="([^"]+)"/)?.[1] ?? null;
    const email = d.match(/<saml2:Attribute Name="email"[^>]*>.*?<saml2:AttributeValue[^>]*>([^<]+)<\/saml2:AttributeValue>/s)?.[1] ?? null;
    const issuer = d.match(/<saml2:Issuer[^>]*>([^<]+)<\/saml2:Issuer>/)?.[1] ?? '';
    const tc = listSamlTenants().find(t => t.idpIssuer === issuer);
    if (!tc) { res.status(401).json({ error: 'Unknown IdP' }); return; }
    if (!nameId) { res.status(400).json({ error: 'Missing NameID' }); return; }
    const token = `saml-${crypto.randomBytes(32).toString('hex')}`;
    storeSamlSession(token, { nameId, tenantId: tc.tenantId, email, sessionIndex: si, attributes: {}, createdAt: new Date() });
    res.cookie('stas_saml_token', token, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 86400000 });
    res.json({ success: true, sessionToken: token, tenantId: tc.tenantId, tenantName: tc.tenantName, nameId, email });
  } catch (err) { log.error({ err: String(err) }, 'ACS failed'); res.status(500).json({ error: 'ACS failed' }); }
});
router.get('/metadata', (req, res) => {
  const tid = req.query.tenant as string; if (!tid) { res.status(400).json({ error: 'Missing tenant' }); return; }
  const c = getSamlTenantConfig(tid); if (!c) { res.status(404).json({ error: 'Not found' }); return; }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.setHeader('Content-Type', 'application/samlmetadata+xml');
  res.send(`<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${esc(c.spEntityId)}"><md:SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat><md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(c.spAcsUrl)}" index="1"/></md:SPSSODescriptor></md:EntityDescriptor>`);
});
router.post('/slo', (req, res) => {
  try {
    let token: string | null = null; const a = req.headers.authorization;
    if (a?.startsWith('Bearer saml-')) token = a.slice(11);
    else { const c = req.headers.cookie; if (c) { for (const p of c.split(';')) { const eq = p.indexOf('='); if (eq !== -1 && p.slice(0, eq).trim() === 'stas_saml_token') { token = p.slice(eq + 1).trim(); break; } } } }
    if (!token) { res.json({ success: true }); return; }
    destroySamlSession(token); res.clearCookie('stas_saml_token'); res.json({ success: true });
  } catch (err) { log.error({ err: String(err) }, 'SLO failed'); res.status(500).json({ error: 'SLO failed' }); }
});
router.get('/session', requireSaml, (req, res) => {
  const u = req.samlUser as EnterpriseUser; const tc = req.samlTenant || getSamlTenantConfig(u.tenantId);
  res.json({ authenticated: true, tenantId: u.tenantId, tenantName: tc?.tenantName || u.tenantId, nameId: u.nameId, email: u.email });
});
router.get('/tenants', (req, res) => {
  if (!ak(req)) { res.status(403).json({ error: 'Admin key required' }); return; }
  res.json({ tenants: listSamlTenants().map(t => ({ tenantId: t.tenantId, tenantName: t.tenantName, idpIssuer: t.idpIssuer, spEntityId: t.spEntityId, enabled: t.enabled })) });
});
router.post('/tenants', (req, res) => {
  if (!ak(req)) { res.status(403).json({ error: 'Admin key required' }); return; }
  const b = req.body as any;
  if (!b.tenantId || !b.tenantName || !b.idpIssuer || !b.idpSsoUrl || !b.idpCert) { res.status(400).json({ error: 'Missing fields' }); return; }
  registerSamlTenant({ tenantId: b.tenantId, tenantName: b.tenantName, idpIssuer: b.idpIssuer, idpSsoUrl: b.idpSsoUrl, idpCert: b.idpCert, spEntityId: b.spEntityId || `${b.tenantId}.stas.dev`, spAcsUrl: b.spAcsUrl || '/api/v1/saml/acs', enabled: b.enabled ?? true });
  res.status(201).json({ success: true });
});
router.delete('/tenants/:tid', (req, res) => {
  if (!ak(req)) { res.status(403).json({ error: 'Admin key required' }); return; }
  if (!getSamlTenantConfig(req.params.tid)) { res.status(404).json({ error: 'Not found' }); return; }
  unregisterSamlTenant(req.params.tid); res.json({ success: true });
});
export { router as samlRouter };
