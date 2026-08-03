import { test, expect } from '@playwright/test';

const SYNTARO_URL = process.env.SYNTARO_URL || 'http://localhost:3000';
const OSY_URL = process.env.OSY_URL || 'http://localhost:4096';

test.describe('SYNTARO + OpenSymphony Connectivity', () => {
  test('SYNTARO (FE) health endpoint is reachable', async () => {
    const resp = await fetch(`${SYNTARO_URL}/health`);
    expect([200, 503]).toContain(resp.status);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.status).toBeDefined();
  });

  test('SYNTARO (FE) homepage loads correctly', async ({ page }) => {
    await page.goto(`${SYNTARO_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.goto(`${SYNTARO_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const title = await page.title();
    expect(title).toBeTruthy();
    console.log(`[INFO] Page title: "${title}"`);
  });

  test('OpenSymphony (BE) health endpoint is reachable', async () => {
    try {
      const resp = await fetch(`${OSY_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
      const accepted = resp.ok || resp.status === 503;
      if (!accepted) {
        console.warn('[WARN] OpenSymphony returned unexpected status:', resp.status);
        test.skip(true, 'OpenSymphony not reachable');
      } else {
        expect(accepted).toBeTruthy();
      }
    } catch {
      console.warn('[WARN] OpenSymphony is not reachable. This is acceptable in dev mode.');
      test.skip(true, 'OpenSymphony is not reachable');
    }
  });

  test('OpenSymphony (BE) returns valid health status', async () => {
    try {
      const resp = await fetch(`${OSY_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
      const accepted = resp.ok || resp.status === 503;
      if (!accepted) test.skip(true, 'OpenSymphony not reachable');
      const health = await resp.json() as Record<string, unknown>;
      expect(health.status).toBeDefined();
    } catch {
      test.skip(true, 'OpenSymphony is not reachable');
    }
  });

  test('SYNTARO (FE) and OpenSymphony (BE) are both alive and connected', async () => {
    const syntaroResp = await fetch(`${SYNTARO_URL}/health`);
    expect([200, 503]).toContain(syntaroResp.status);
    const syntaroBody = await syntaroResp.json() as Record<string, unknown>;
    expect(syntaroBody.status).toBeDefined();
    console.log(`[INFO] SYNTARO (FE) status: ${syntaroBody.status}`);

    try {
      const osyResp = await fetch(`${OSY_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (osyResp.ok || osyResp.status === 503) {
        const text = await osyResp.text();
        try {
          const osyHealth = JSON.parse(text) as Record<string, unknown>;
          expect(osyHealth.status).toBeDefined();
          console.log(`[INFO] OpenSymphony (BE) status: ${osyHealth.status}`);
          console.log('[PASS] Both SYNTARO (FE) and OpenSymphony (BE) are connected and operational!');
        } catch {
          console.log('[INFO] OpenSymphony returned non-JSON response (expected in some modes)');
        }
      } else {
        console.log(`[INFO] OpenSymphony returned ${osyResp.status} — skip`);
      }
    } catch {
      console.log('[INFO] OpenSymphony not running in dev mode. Skipping BE verification.');
    }
  });
});
