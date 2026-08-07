/**
 * Forge Invocation Token (FIT) verification + auth-context extraction.
 *
 * Every request from the Forge platform to a Forge remote carries:
 *   - `Authorization: Bearer <FIT>`            — JWT signed by Atlassian
 *   - `x-forge-oauth-system: <token>`          — JWT, app bot identity (also
 *     usable as `Bearer` for Bitbucket REST and `x-token-auth` for git)
 *
 * FIT signature is verified against the Forge JWKS (default:
 * https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json). When
 * FORGE_SKIP_FIT_VERIFY=true (local dev only), only the claims are decoded.
 *
 * Docs: https://developer.atlassian.com/platform/forge/remote/calling-product-apis/
 */

import { type JsonWebKey as CryptoJsonWebKey, createPublicKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { FitClaims, ForgeRequestContext, ForgeSystemTokenClaims } from './types.js';

const DEFAULT_JWKS_URL = 'https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface Jwk extends CryptoJsonWebKey {
  kid?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

export class FitVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FitVerificationError';
  }
}

async function fetchJwks(): Promise<Jwk[]> {
  const url = config.forge.jwksUrl || DEFAULT_JWKS_URL;
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new FitVerificationError(`Forge JWKS fetch failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

function keyToPem(jwk: Jwk): KeyObject {
  return createPublicKey({ key: jwk, format: 'jwk' });
}

/** Verify the FIT signature against the Forge JWKS and return its claims. */
export async function verifyFit(authorizationHeader: string | undefined): Promise<FitClaims> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new FitVerificationError('Missing FIT token in Authorization header');
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) throw new FitVerificationError('Empty FIT token');

  if (!config.forge.skipFitVerify) {
    const keys = await fetchJwks();
    const header = jwt.decode(token, { complete: true });
    const kid = header && typeof header === 'object' ? (header.header?.kid as string | undefined) : undefined;
    const key = keys.find((k) => k.kid === kid);
    if (!key) {
      throw new FitVerificationError(`No Forge JWKS key matches FIT kid "${kid ?? '(none)'}"`);
    }
    jwt.verify(token, keyToPem(key), { algorithms: ['RS256', 'ES256', 'PS256'] });
  }

  const claims = jwt.decode(token) as FitClaims | null;
  if (!claims || typeof claims !== 'object' || !claims.app?.id || !claims.app?.installationId) {
    throw new FitVerificationError('FIT token missing required app claims');
  }
  if (config.forge.appId && claims.app.id !== config.forge.appId) {
    throw new FitVerificationError(`FIT app id mismatch: expected ${config.forge.appId}, got ${claims.app.id}`);
  }
  return claims;
}

/** Decode the x-forge-oauth-system token (expiry only — Atlassian-signed). */
export function decodeSystemToken(systemToken: string | undefined): ForgeSystemTokenClaims | null {
  if (!systemToken) return null;
  try {
    const claims = jwt.decode(systemToken) as ForgeSystemTokenClaims | null;
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** Build the full request context from headers. Throws FitVerificationError. */
export async function extractForgeContext(
  authorizationHeader: string | undefined,
  systemTokenHeader: string | undefined,
): Promise<ForgeRequestContext> {
  const fit = await verifyFit(authorizationHeader);
  if (!systemTokenHeader) {
    throw new FitVerificationError('Missing x-forge-oauth-system header (appSystemToken not enabled?)');
  }
  const sysClaims = decodeSystemToken(systemTokenHeader);
  const expiresAt = typeof sysClaims?.exp === 'number' ? new Date(sysClaims.exp * 1000) : null;
  return {
    appId: fit.app.id,
    installationId: fit.app.installationId,
    apiBaseUrl: fit.app.apiBaseUrl,
    systemToken: systemTokenHeader,
    systemTokenExpiresAt: expiresAt,
  };
}
