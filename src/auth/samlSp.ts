/**
 * Minimal SAML 2.0 Service Provider (AIM-4496).
 *
 * Implements the SP side of SAML Web Browser SSO using only Node built-ins:
 *   - SP metadata generation (GET /api/v1/saml/metadata)
 *   - AuthnRequest for the redirect binding (GET /api/v1/saml/login)
 *   - ACS endpoint for the POST binding (POST /api/v1/saml/acs)
 *   - Optional response signature verification with the IdP's X.509 cert
 *
 * Sessions are stored via the existing SAML session store in
 * src/middleware/saml.ts. Tenant configs come from the same registry, seeded
 * from env (SAML_TENANT_*_IDP_*) or via the admin config endpoint.
 */

import crypto, { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'saml-sp' });

// ── XML helpers ────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extract the text content of the first element matching a tag path.
 * Uses a tolerant regex so self-closing and namespaced tags both match.
 */
function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)</[^>]*${tag}[^>]*>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * Extract the first AttributeValue inside an Attribute element with the given
 * Name attribute.
 */
function extractAttrValue(xml: string, attrName: string): string | null {
  const re = new RegExp(
    `<[^>]*Attribute[^>]*Name=["']?${attrName}["']?[^>]*>([\\s\\S]*?)</[^>]*Attribute(?!Value)[^>]*>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return null;
  const valueRe = /<[^>]*AttributeValue[^>]*>([\s\S]*?)<\/[^>]*AttributeValue[^>]*>/i;
  const vm = valueRe.exec(m[0]);
  return vm ? vm[1].trim() : null;
}

// ── AuthnRequest ───────────────────────────────────────────────────────────

export interface AuthnRequestContext {
  requestId: string;
  requestXml: string;
  /** URL-safe base64 of the deflated+base64-encoded request for redirect binding. */
  samlRequest: string;
}

/**
 * Build a SAML AuthnRequest for the redirect binding and encode it the way
 * IdPs expect (deflate, then base64, then URL-encode).
 */
export function buildAuthnRequest(tenant: {
  tenantId: string;
  spEntityId: string;
  spAcsUrl: string;
  idpSsoUrl: string;
  tenantName?: string;
}): AuthnRequestContext {
  const requestId = `_${randomUUID().replace(/-/g, '')}`;
  const issueInstant = new Date().toISOString();
  const requestXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
    ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
    ` ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}"`,
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
    ` AssertionConsumerServiceURL="${escapeXml(tenant.spAcsUrl)}"`,
    ` Destination="${escapeXml(tenant.idpSsoUrl)}">`,
    `<saml:Issuer>${escapeXml(tenant.spEntityId)}</saml:Issuer>`,
    `<samlp:NameIDPolicy AllowCreate="true" Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/>`,
    `<samlp:RequestedAuthnContext Comparison="exact">`,
    `<saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>`,
    `</samlp:RequestedAuthnContext>`,
    `</samlp:AuthnRequest>`,
  ].join('');
  const deflated = zlib.deflateRawSync(Buffer.from(requestXml, 'utf-8'));
  const samlRequest = deflated.toString('base64');
  return { requestId, requestXml, samlRequest };
}

// ── Response parsing ───────────────────────────────────────────────────────

export interface SamlAssertion {
  nameId: string;
  nameIdFormat: string | null;
  email: string | null;
  attributes: Record<string, string[]>;
  sessionIndex: string | null;
  issueInstant: string | null;
}

/**
 * Parse a SAML Response's Assertion: extract NameID, email Attribute, and any
 * other AttributeStatements. Tolerant of common IdP variants.
 */
export function parseSamlResponse(base64Response: string): SamlAssertion {
  const decoded = Buffer.from(base64Response, 'base64').toString('utf-8');

  const nameIdRaw = extractTag(decoded, 'NameID') ?? '';
  const nameId = nameIdRaw.replace(/<[^>]+>/g, '').trim();

  let email: string | null = null;
  for (const attr of ['email', 'emailaddress', 'mail']) {
    const value = extractAttrValue(decoded, attr);
    if (value) {
      email = value;
      break;
    }
  }
  if (!email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nameId)) {
    email = nameId;
  }

  const attributes: Record<string, string[]> = {};
  const attrRe = /<[^>]*Attribute[^>]*Name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]*Attribute(?!Value)[^>]*>/gi;
  let m = attrRe.exec(decoded);
  while (m) {
    const key = m[1];
    const values = [...m[2].matchAll(/<[^>]*AttributeValue[^>]*>([\s\S]*?)<\/[^>]*AttributeValue[^>]*>/gi)]
      .map((v) => v[1].trim())
      .filter(Boolean);
    attributes[key] = values;
    m = attrRe.exec(decoded);
  }

  const sessionIndexRe = /<[^>]*AuthnStatement[^>]*SessionIndex=["']([^"']+)["']/i;
  const sessionIndex = sessionIndexRe.exec(decoded)?.[1] ?? null;
  const issueInstantRe = /<[^>]*Assertion[^>]*IssueInstant=["']([^"']+)["']/i;
  const issueInstant = issueInstantRe.exec(decoded)?.[1] ?? null;

  return { nameId, nameIdFormat: null, email, attributes, sessionIndex, issueInstant };
}

// ── Signature verification ─────────────────────────────────────────────────

/**
 * Verify the XML signature of a SAML response against the IdP's X.509 cert
 * (PEM). Returns true when the signature is valid or when no cert is configured
 * (signature verification is then skipped — useful for a mock IdP).
 */
export function verifySamlSignature(
  base64Response: string,
  idpCertPem?: string | null,
): { verified: boolean; reason: string } {
  if (!idpCertPem || idpCertPem.trim() === '') {
    return { verified: true, reason: 'no IdP cert configured — signature verification skipped' };
  }

  const decoded = Buffer.from(base64Response, 'base64').toString('utf-8');

  const digestRe = /<[^>]*DigestValue[^>]*>([A-Za-z0-9+/=]+)<\/[^>]*DigestValue[^>]*>/i;
  const digestB64 = digestRe.exec(decoded)?.[1];
  if (!digestB64) {
    return { verified: false, reason: 'no DigestValue found in response' };
  }

  const signatureRe = /<[^>]*SignatureValue[^>]*>([A-Za-z0-9+/=]+)<\/[^>]*SignatureValue[^>]*>/i;
  const sigB64 = signatureRe.exec(decoded)?.[1];
  if (!sigB64) {
    return { verified: false, reason: 'no SignatureValue found in response' };
  }

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(decoded);
    verifier.end();
    const valid = verifier.verify(idpCertPem, Buffer.from(sigB64, 'base64'));
    return { verified: valid, reason: valid ? 'signature valid' : 'signature verification failed' };
  } catch (err) {
    return { verified: false, reason: `signature verification error: ${String(err)}` };
  }
}

// ── SP metadata ────────────────────────────────────────────────────────────

/**
 * Generate the SP metadata XML document for a tenant. Includes the ACS URL,
 * entity ID, and (when a cert is configured) the SP signing cert.
 */
export function buildSpMetadata(tenant: {
  tenantId: string;
  spEntityId: string;
  spAcsUrl: string;
  spCertPem?: string | null;
}): string {
  const certDescriptors = tenant.spCertPem
    ? (() => {
        const certB64 = tenant.spCertPem
          .replace(/-----BEGIN CERTIFICATE-----/g, '')
          .replace(/-----END CERTIFICATE-----/g, '')
          .replace(/\s+/g, '');
        return `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;
      })()
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"`,
    ` entityID="${escapeXml(tenant.spEntityId)}">`,
    `<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" ProtocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
    certDescriptors,
    `<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>`,
    `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
    ` Location="${escapeXml(tenant.spAcsUrl)}" index="0" isDefault="true"/>`,
    `</md:SPSSODescriptor>`,
    `</md:EntityDescriptor>`,
  ].join('');
}

// ── Env seeding helper ─────────────────────────────────────────────────────

/**
 * Seed SAML tenants from env vars (SAML_TENANT_<ID>_IDP_SSO_URL etc.) so the
 * SP works without the admin API. Runs once at startup.
 */
export function seedSamlTenantsFromEnv(
  register: (cfg: {
    tenantId: string;
    tenantName: string;
    idpIssuer: string;
    idpSsoUrl: string;
    idpCert: string;
    spEntityId: string;
    spAcsUrl: string;
    enabled: boolean;
  }) => void,
  env: NodeJS.ProcessEnv = process.env,
  baseUrl = env.STAS_PUBLIC_URL || `http://localhost:${env.PORT || 3000}`,
): void {
  for (const [key, value] of Object.entries(env)) {
    const match = /^SAML_TENANT_([A-Z0-9_]+)_IDP_SSO_URL$/.exec(key);
    if (!match || !value) continue;
    const suffix = match[1];
    const tenantId = (env[`SAML_TENANT_${suffix}_ID`] || suffix).toLowerCase();
    const spEntityId =
      env[`SAML_TENANT_${suffix}_SP_ENTITY_ID`] || `${baseUrl}/api/v1/saml/metadata?tenant=${tenantId}`;
    register({
      tenantId,
      tenantName: env[`SAML_TENANT_${suffix}_NAME`] || tenantId,
      idpIssuer: env[`SAML_TENANT_${suffix}_IDP_ISSUER`] || 'https://idp.example.com',
      idpSsoUrl: value,
      idpCert: env[`SAML_TENANT_${suffix}_IDP_CERT`] || '',
      spEntityId,
      spAcsUrl: env[`SAML_TENANT_${suffix}_SP_ACS_URL`] || `${baseUrl}/api/v1/saml/acs`,
      enabled: true,
    });
    log.info({ tenantId, idpSsoUrl: value }, 'Seeded SAML tenant from env');
  }
}
