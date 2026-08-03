import { describe, it, expect } from 'vitest';
import {
  buildAuthnRequest,
  buildSpMetadata,
  parseSamlResponse,
  verifySamlSignature,
  seedSamlTenantsFromEnv,
} from '../../auth/samlSp.js';

const SAMPLE_RESPONSE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
  ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
  ' ID="_response1" Version="2.0" IssueInstant="2026-01-01T00:00:00Z">',
  '<saml:Issuer>https://idp.example.com</saml:Issuer>',
  '<saml:Assertion ID="_assertion1" IssueInstant="2026-01-01T00:00:00Z">',
  '<saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>',
  '<saml:AuthnStatement SessionIndex="abc123"/>',
  '<saml:AttributeStatement>',
  '<saml:Attribute Name="email"><saml:AttributeValue>bob@example.com</saml:AttributeValue></saml:Attribute>',
  '<saml:Attribute Name="groups"><saml:AttributeValue>admins</saml:AttributeValue></saml:Attribute>',
  '</saml:AttributeStatement>',
  '</saml:Assertion>',
  '</samlp:Response>',
].join('');

describe('buildAuthnRequest', () => {
  it('produces a deflated base64 SAMLRequest', () => {
    const authn = buildAuthnRequest({
      tenantId: 'acme',
      spEntityId: 'https://stas.local/api/v1/saml/metadata',
      spAcsUrl: 'https://stas.local/api/v1/saml/acs',
      idpSsoUrl: 'https://idp.example.com/sso',
    });
    expect(authn.requestId).toMatch(/^_/);
    expect(authn.samlRequest).toBeTruthy();
    // Must decode back to valid XML containing an AuthnRequest
    const zlib = require('node:zlib');
    const decoded = zlib.inflateRawSync(Buffer.from(authn.samlRequest, 'base64')).toString('utf-8');
    expect(decoded).toContain('<samlp:AuthnRequest');
    expect(decoded).toContain('https://stas.local/api/v1/saml/acs');
  });
});

describe('buildSpMetadata', () => {
  it('includes entity ID and ACS location', () => {
    const metadata = buildSpMetadata({
      tenantId: 'acme',
      spEntityId: 'https://stas.local/sp',
      spAcsUrl: 'https://stas.local/api/v1/saml/acs',
    });
    expect(metadata).toContain('entityID="https://stas.local/sp"');
    expect(metadata).toContain('https://stas.local/api/v1/saml/acs');
  });

  it('embeds the SP signing cert when provided', () => {
    const metadata = buildSpMetadata({
      tenantId: 'acme',
      spEntityId: 'https://stas.local/sp',
      spAcsUrl: 'https://stas.local/acs',
      spCertPem: '-----BEGIN CERTIFICATE-----\nAAAABBBB\n-----END CERTIFICATE-----',
    });
    expect(metadata).toContain('AAAABBBB');
    expect(metadata).toContain('KeyDescriptor');
  });
});

describe('parseSamlResponse', () => {
  const base64 = Buffer.from(SAMPLE_RESPONSE, 'utf-8').toString('base64');

  it('extracts NameID, email attribute, and session index', () => {
    const assertion = parseSamlResponse(base64);
    expect(assertion.nameId).toBe('alice@example.com');
    expect(assertion.email).toBe('bob@example.com');
    expect(assertion.sessionIndex).toBe('abc123');
    expect(assertion.attributes.groups).toEqual(['admins']);
  });

  it('falls back to NameID as email when no email attribute exists', () => {
    const noEmail = SAMPLE_RESPONSE.replace(
      '<saml:Attribute Name="email"><saml:AttributeValue>bob@example.com</saml:AttributeValue></saml:Attribute>',
      '',
    );
    const assertion = parseSamlResponse(Buffer.from(noEmail, 'utf-8').toString('base64'));
    expect(assertion.email).toBe('alice@example.com');
  });
});

describe('verifySamlSignature', () => {
  it('skips verification when no IdP cert is configured (mock IdP)', () => {
    const result = verifySamlSignature('bm90LXhtbA==', null);
    expect(result.verified).toBe(true);
  });

  it('rejects a response with a configured cert but no signature', () => {
    const result = verifySamlSignature('bm90LXhtbA==', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----');
    expect(result.verified).toBe(false);
  });
});

describe('seedSamlTenantsFromEnv', () => {
  it('registers tenants declared via SAML_TENANT_* env vars', () => {
    const registered: string[] = [];
    seedSamlTenantsFromEnv(
      (cfg) => {
        registered.push(cfg.tenantId);
      },
      {
        SAML_TENANT_ACME_IDP_SSO_URL: 'https://idp.acme.com/sso',
        SAML_TENANT_ACME_NAME: 'Acme Corp',
        STAS_PUBLIC_URL: 'https://stas.example.com',
      },
      'https://stas.example.com',
    );
    expect(registered).toContain('acme');
  });
});
