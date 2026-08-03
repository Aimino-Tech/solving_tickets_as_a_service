import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { config } from '../config.js';
import { destroySamlSession, getSamlTenantConfig, registerSamlTenant, storeSamlSession } from '../middleware/saml.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'saml-routes' });

const router: Router = Router();

const DEFAULT_SP_ENTITY_ID = 'https://syntaro.dev/saml/metadata';

// Auto-register a default tenant from environment configuration. This makes
// the registry non-empty when operators configure SAML via env vars, which
// is the only deployment path today (there is no admin UI yet).
if (config.saml.tenantId !== '' && config.saml.idpSsoUrl !== '') {
  registerSamlTenant({
    tenantId: config.saml.tenantId,
    tenantName: config.saml.tenantName,
    idpIssuer: config.saml.idpIssuer,
    idpSsoUrl: config.saml.idpSsoUrl,
    idpCert: config.saml.idpCert,
    spEntityId: config.saml.spEntityId || DEFAULT_SP_ENTITY_ID,
    spAcsUrl: config.saml.spAcsUrl,
    enabled: true,
  });
  log.info({ tenantId: config.saml.tenantId, idpSsoUrl: config.saml.idpSsoUrl }, 'Auto-registered default SAML tenant');
}

function spEntityId(): string {
  return config.saml.spEntityId || DEFAULT_SP_ENTITY_ID;
}

function spAcsUrl(): string {
  return config.saml.spAcsUrl || `${config.saml.dashboardUrl || 'http://localhost:3000'}/api/v1/saml/acs`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * SP metadata document — consumed by the IdP to configure the SAML
 * integration (entity ID, ACS endpoint, NameID format).
 */
router.get('/metadata', (_req: Request, res: Response) => {
  const entityId = spEntityId();
  const acsUrl = spAcsUrl();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
    ` entityID="${escapeXml(entityId)}">`,
    '  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    '    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>',
    `    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(acsUrl)}" index="0" isDefault="true"/>`,
    '  </md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ].join('\n');
  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(xml);
});

/**
 * SP-initiated login: redirects the browser to the IdP SSO URL. The flow is
 * deliberately IdP-initiated friendly (no signed AuthnRequest) so it works
 * with any IdP without certificate management on the SP side.
 */
router.get('/login', (_req: Request, res: Response) => {
  const tenant = getSamlTenantConfig(config.saml.tenantId);
  if (!tenant || !tenant.enabled) {
    res.status(400).json({ error: 'SAML not configured' });
    return;
  }
  res.redirect(302, tenant.idpSsoUrl);
});

/**
 * Assertion Consumer Service (ACS). Receives the IdP POST of the SAML
 * response, extracts the NameID/email, opens a local session, and redirects
 * the browser back to the dashboard with an httpOnly session cookie.
 */
router.post('/acs', async (req: Request, res: Response) => {
  const tenant = getSamlTenantConfig(config.saml.tenantId);
  if (!tenant || !tenant.enabled) {
    res.status(400).json({ error: 'SAML not configured' });
    return;
  }

  const rawResponse: unknown = (req.body ?? {})?.SAMLResponse;
  if (typeof rawResponse !== 'string' || rawResponse === '') {
    res.status(400).json({ error: 'Missing SAMLResponse' });
    return;
  }

  let decoded = '';
  try {
    decoded = Buffer.from(rawResponse, 'base64').toString('utf-8');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to base64-decode SAMLResponse');
    res.status(400).json({ error: 'Malformed SAMLResponse' });
    return;
  }

  const nameIdMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
  const emailMatch = decoded.match(/<saml:Attribute Name="email"[^>]*>.*?<saml:AttributeValue[^>]*>([^<]+)/s);
  const nameId = nameIdMatch ? nameIdMatch[1].trim() : null;
  const email = emailMatch ? emailMatch[1].trim() : nameId && nameId.includes('@') ? nameId : null;

  if (!nameId) {
    res.status(400).json({ error: 'SAMLResponse did not contain a NameID' });
    return;
  }

  const sessionToken = randomUUID();
  storeSamlSession(
    sessionToken,
    {
      nameId,
      tenantId: tenant.tenantId,
      email,
      sessionIndex: null,
      attributes: {},
      createdAt: new Date(),
    },
    86400000,
  );

  res.cookie('syntaro_saml_token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 86400000,
  });
  log.info({ tenantId: tenant.tenantId, nameId }, 'SAML session established');

  const redirectTo = config.saml.dashboardUrl || '/';
  res.redirect(302, redirectTo);
});

/**
 * Logout: destroys the local SAML session and clears the session cookie.
 */
router.get('/logout', (req: Request, res: Response) => {
  const cookies: Record<string, string> = (req.headers.cookie ?? '')
    .split(';')
    .reduce((acc: Record<string, string>, part) => {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        acc[key] = value;
      }
      return acc;
    }, {});
  const token = cookies['syntaro_saml_token'];
  if (token) {
    destroySamlSession(token);
  }
  res.clearCookie('syntaro_saml_token');
  const redirectTo = config.saml.dashboardUrl || '/';
  res.redirect(302, redirectTo);
});

export default router;
