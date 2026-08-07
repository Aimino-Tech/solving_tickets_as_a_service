#!/usr/bin/env node
/**
 * Bitbucket OAuth callback check (bb:oauth-check)
 *
 * Verifies that SYNTARO_PUBLIC_URL (the redirect_uri SYNTARO sends) is
 * registered as the Callback URL on the Bitbucket OAuth consumer, WITHOUT
 * needing a browser login. Probes Bitbucket's token endpoint with a fake
 * authorization code and interprets the error:
 *
 *   - "host must match configured redirect uri" → consumer callback ≠ SYNTARO_PUBLIC_URL (FIX NEEDED)
 *   - "The specified code is not valid." (invalid_grant) → callback matches, flow is wired correctly
 *   - anything else → inspect manually
 *
 * Usage:
 *   npm run bb:oauth-check            (reads .env: BITBUCKET_OAUTH_CLIENT_ID/SECRET, SYNTARO_PUBLIC_URL)
 *   BITBUCKET_OAUTH_CLIENT_ID=... BITBUCKET_OAUTH_CLIENT_SECRET=... SYNTARO_PUBLIC_URL=... npm run bb:oauth-check
 *
 * Exit codes: 0 = callback matches (green), 1 = mismatch (red, actionable message), 2 = config missing.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env from repo root (works when run via npm from the repo root).
for (const p of ['.env', '../.env']) {
  if (existsSync(p)) {
    loadEnv({ path: resolve(p) });
    break;
  }
}

const clientId = process.env.BITBUCKET_OAUTH_CLIENT_ID;
const clientSecret = process.env.BITBUCKET_OAUTH_CLIENT_SECRET;
const publicUrl = process.env.SYNTARO_PUBLIC_URL;

if (!clientId || !clientSecret || !publicUrl) {
  console.error(
    'Missing env. Set BITBUCKET_OAUTH_CLIENT_ID, BITBUCKET_OAUTH_CLIENT_SECRET and SYNTARO_PUBLIC_URL.',
  );
  process.exit(2);
}

const redirectUri = `${publicUrl.replace(/\/$/, '')}/api/v1/auth/bitbucket/callback`;

console.log('Bitbucket OAuth callback check');
console.log(`  client_id    : ${clientId}`);
console.log(`  redirect_uri : ${redirectUri}`);
console.log('  probing Bitbucket token endpoint with a fake code...\n');

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code: 'syntaro-oauth-check-fake-code',
  redirect_uri: redirectUri,
});

const res = await fetch('https://bitbucket.org/site/oauth2/access_token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body,
});

const json = (await res.json().catch(() => ({}))) ?? {};
const msg = json.error_description || json.error || `HTTP ${res.status}`;

if (/host must match configured redirect uri/i.test(msg)) {
  console.error(`\u274c MISMATCH — "${msg}"`);
  console.error(`\nThe Callback URL registered on the Bitbucket OAuth client is NOT ${redirectUri}.`);
  console.error('Fix in Bitbucket: Workspace settings \u2192 OAuth clients \u2192 edit the SYNTARO client');
  console.error(`  \u2192 set "Callback URL" to exactly: ${redirectUri}`);
  console.error('Then re-run this check.');
  process.exit(1);
}

if (/code is not valid|invalid_grant/i.test(msg)) {
  console.log(`\u2705 Callback matches — Bitbucket accepted ${redirectUri} (expected "invalid_grant" for the fake code).`);
  console.log('The OAuth flow is wired correctly. Connect from the dashboard now.');
  process.exit(0);
}

console.warn(`\u26a0\ufe0f Unexpected response (${res.status}): ${msg}`);
console.warn('Inspect manually; the callback may still be fine.');
process.exit(0);
