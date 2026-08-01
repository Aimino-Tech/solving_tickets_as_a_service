import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { rootLogger } from '../utils/logger.js';
import {
  getSamlTenantConfig,
  listSamlTenants,
  registerSamlTenant,
  unregisterSamlTenant,
  storeSamlSession,
} from '../middleware/saml.js';
import {
  buildAuthnRequest,
  buildSpMetadata,
  parseSamlResponse,
  verifySamlSignature,
} from '../auth/samlSp.js';
import { seedSamlTenantsFromEnv } from '../auth/samlSp.js';

const log = rootLogger.child({ module: 'saml-api' });
const router: Router = Router();

const baseUrl = () => process.env.STAS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

function resolveTenantId(req: Request): string | undefined {
  return (req.headers['x-saml-tenant'] as string) || (req.query.tenant as string);
}

function requireTenant(req: Request, res: Response): ReturnType<typeof getSamlTenantConfig> | null {
  const tenantId = resolveTenantId(req);
  const tenant = tenantId ? getSamlTenantConfig(tenantId) : undefined;
  if (!tenant) {
    res.status(404).json({ error: 'Unknown SAML tenant', tenants: listSamlTenants().map((t) => t.tenantId) });
    return null;
  }
  return tenant;
}

// GET /api/v1/saml/metadata — SP metadata XML for a tenant
router.get('/metadata', (req: Request, res: Response) => {
  const tenant = requireTenant(req, res);
  if (!tenant) return;
  const metadata = buildSpMetadata({
    tenantId: tenant.tenantId,
    spEntityId: tenant.spEntityId,
    spAcsUrl: tenant.spAcsUrl,
    spCertPem: process.env.SAML_SP_CERT || null,
  });
  res
    .status(200)
    .setHeader('Content-Type', 'application/samlmetadata+xml')
    .send(metadata);
});

// GET /api/v1/saml/login — redirect to the IdP SSO URL with an AuthnRequest
router.get('/login', (req: Request, res: Response) => {
  const tenant = requireTenant(req, res);
  if (!tenant) return;
  if (!tenant.enabled) {
    res.status(403).json({ error: `SAML tenant "${tenant.tenantId}" is disabled` });
    return;
  }
  const authn = buildAuthnRequest({ ...tenant, tenantName: tenant.tenantName });
  const redirectUrl = `${tenant.idpSsoUrl}?SAMLRequest=${encodeURIComponent(authn.samlRequest)}&RelayState=${encodeURIComponent(tenant.tenantId)}`;
  log.info({ tenantId: tenant.tenantId, requestId: authn.requestId }, 'Redirecting to IdP SSO');
  res.redirect(302, redirectUrl);
});

// POST /api/v1/saml/acs — Assertion Consumer Service
// Body (form): { SAMLResponse, RelayState }
router.post('/acs', async (req: Request, res: Response) => {
  const samlResponse = typeof req.body?.SAMLResponse === 'string' ? req.body.SAMLResponse : undefined;
  if (!samlResponse) {
    res.status(400).json({ error: 'Missing SAMLResponse' });
    return;
  }

  const tenantId = (req.body?.RelayState as string) || (req.headers['x-saml-tenant'] as string);
  const tenant = tenantId ? getSamlTenantConfig(tenantId) : undefined;
  if (!tenant) {
    res.status(404).json({ error: 'Unknown SAML tenant', tenants: listSamlTenants().map((t) => t.tenantId) });
    return;
  }

  const signatureCheck = verifySamlSignature(samlResponse, tenant.idpCert || null);
  if (!signatureCheck.verified) {
    log.warn({ tenantId: tenant.tenantId, reason: signatureCheck.reason }, 'SAML response signature invalid');
    res.status(401).json({ error: `SAML response verification failed: ${signatureCheck.reason}` });
    return;
  }

  let assertion;
  try {
    assertion = parseSamlResponse(samlResponse);
  } catch (err) {
    log.error({ err: String(err), tenantId: tenant.tenantId }, 'Failed to parse SAML response');
    res.status(400).json({ error: 'Failed to parse SAML response' });
    return;
  }

  if (!assertion.nameId && !assertion.email) {
    res.status(400).json({ error: 'SAML response contains no NameID or email' });
    return;
  }

  const sessionToken = `saml-${cryptoRandomToken()}`;
  storeSamlSession(sessionToken, {
    nameId: assertion.nameId,
    tenantId: tenant.tenantId,
    email: assertion.email,
    sessionIndex: assertion.sessionIndex,
    attributes: assertion.attributes,
    createdAt: new Date(),
  });

  log.info({ tenantId: tenant.tenantId, nameId: assertion.nameId, email: assertion.email }, 'SAML session established');

  const frontendUrl = process.env.SAML_SUCCESS_REDIRECT || baseUrl();
  const redirect = `${frontendUrl}/auth/saml/success?token=${encodeURIComponent(sessionToken)}&tenant=${encodeURIComponent(tenant.tenantId)}`;
  res.redirect(302, redirect);
});

function cryptoRandomToken(): string {
  return randomBytes(32).toString('hex');
}

// GET /api/v1/saml/tenants — list registered tenants (admin config)
router.get('/tenants', (_req: Request, res: Response) => {
  res.json({
    tenants: listSamlTenants().map((t) => ({
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      idpIssuer: t.idpIssuer,
      idpSsoUrl: t.idpSsoUrl,
      spEntityId: t.spEntityId,
      spAcsUrl: t.spAcsUrl,
      enabled: t.enabled,
    })),
  });
});

const tenantSchema = z.object({
  tenantId: z.string().min(1).max(100),
  tenantName: z.string().optional(),
  idpIssuer: z.string().min(1),
  idpSsoUrl: z.string().url(),
  idpCert: z.string().optional(),
  spEntityId: z.string().optional(),
  spAcsUrl: z.string().optional(),
  enabled: z.boolean().optional(),
});

// POST /api/v1/saml/tenants — register or update a tenant (admin config endpoint)
router.post('/tenants', (req: Request, res: Response) => {
  const parsed = tenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }
  const cfg = parsed.data;
  const url = baseUrl();
  registerSamlTenant({
    tenantId: cfg.tenantId,
    tenantName: cfg.tenantName || cfg.tenantId,
    idpIssuer: cfg.idpIssuer,
    idpSsoUrl: cfg.idpSsoUrl,
    idpCert: cfg.idpCert || '',
    spEntityId: cfg.spEntityId || `${url}/api/v1/saml/metadata?tenant=${cfg.tenantId}`,
    spAcsUrl: cfg.spAcsUrl || `${url}/api/v1/saml/acs`,
    enabled: cfg.enabled ?? true,
  });
  log.info({ tenantId: cfg.tenantId }, 'SAML tenant registered via admin API');
  res.status(201).json({ success: true, tenantId: cfg.tenantId });
});

// DELETE /api/v1/saml/tenants/:tenantId — unregister a tenant
router.delete('/tenants/:tenantId', (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const existing = getSamlTenantConfig(tenantId);
  if (!existing) {
    res.status(404).json({ error: 'Unknown tenant' });
    return;
  }
  unregisterSamlTenant(tenantId);
  res.status(204).end();
});

// Seeding on import — register tenants declared in the environment.
try {
  seedSamlTenantsFromEnv(registerSamlTenant);
} catch (err) {
  log.warn({ err: String(err) }, 'SAML env seeding skipped');
}

export default router;
