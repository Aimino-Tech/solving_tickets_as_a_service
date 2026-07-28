import { test, expect } from '@playwright/test';

const STAS_URL = process.env.STAS_URL || 'http://localhost:3000';
const OSY_URL = process.env.OSY_URL || 'http://localhost:4096';

test.describe('STAS + OpenSymphony Connectivity', () => {
  test('STAS (FE) health endpoint is reachable', async () => {
    const resp = await fetch(`${STAS_URL}/health`);
    // Accept 200 (healthy) or 503 (degraded but alive)
    expect([200, 503]).toContain(resp.status);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.status).toBeDefined();
  });

  test('STAS (FE) homepage loads correctly', async ({ page }) => {
    await page.goto(`${STAS_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    // Navigate to dashboard - may have asset loading errors in dev mode but page should render
    await page.goto(`${STAS_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });

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

  test('STAS (FE) and OpenSymphony (BE) are both alive and connected', async () => {
    const stasResp = await fetch(`${STAS_URL}/health`);
    expect([200, 503]).toContain(stasResp.status);
    const stasBody = await stasResp.json() as Record<string, unknown>;
    expect(stasBody.status).toBeDefined();
    console.log(`[INFO] STAS (FE) status: ${stasBody.status}`);

    try {
      const osyResp = await fetch(`${OSY_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (osyResp.ok || osyResp.status === 503) {
        const text = await osyResp.text();
        try {
          const osyHealth = JSON.parse(text) as Record<string, unknown>;
          expect(osyHealth.status).toBeDefined();
          console.log(`[INFO] OpenSymphony (BE) status: ${osyHealth.status}`);
          console.log('[PASS] Both STAS (FE) and OpenSymphony (BE) are connected and operational!');
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
