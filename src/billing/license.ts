import crypto from 'node:crypto';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'billing-license' });

interface LicensePayload {
  customerId: string;
  plan: 'selfHosted' | 'enterprise';
  issuedAt: number;
  expiresAt: number;
  features: string[];
}

const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvT3I4v0Y0CJq0c1n0kFf
8L7Q5K2m0wXJh3r2v5b6c9d8e7f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z
-----END PUBLIC KEY-----`;

function getLicensePublicKey(): string {
  return process.env.LICENSE_PUBLIC_KEY || LICENSE_PUBLIC_KEY;
}

export function isSelfHosted(): boolean {
  return config.stas.mode !== 'hosted' && !process.env.STRIPE_SECRET_KEY;
}

export function verifyLicenseKey(key: string): LicensePayload | null {
  try {
    const parts = key.split('.');
    if (parts.length !== 2) return null;

    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as LicensePayload;
    const signature = parts[1];

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(parts[0]);

    const isValid = verifier.verify(getLicensePublicKey(), signature, 'base64url');
    if (!isValid) return null;

    if (Date.now() > payload.expiresAt) {
      log.warn({ customerId: payload.customerId }, 'License key expired');
      return null;
    }

    return payload;
  } catch (err) {
    log.error({ err: String(err) }, 'License key verification failed');
    return null;
  }
}

export function getSelfHostedEntitlements(): {
  plan: 'selfHosted';
  features: string[];
} {
  const licenseKey = process.env.STAS_LICENSE_KEY;
  if (licenseKey) {
    const license = verifyLicenseKey(licenseKey);
    if (license) {
      return { plan: 'selfHosted', features: license.features };
    }
    log.warn('Invalid license key, falling back to OSS defaults');
  }

  return {
    plan: 'selfHosted',
    features: [
      'unlimited-fixes',
      'your-api-key',
      'community-support',
    ],
  };
}
