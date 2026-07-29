import { test, expect } from '../../fixtures/stas-fixtures.js';

const VITE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3002';

async function getAuthToken(): Promise<{ token: string }> {
  const email = `e2e-${Date.now()}@test.com`;
  const res = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123', name: 'E2E Tester' }),
  });
  if (!res.ok) throw new Error(`Register failed: ${await res.text()}`);
  return res.json();
}

test.describe('Dashboard with Real Data', () => {
  let auth: { token: string };

  test.beforeAll(async () => {
    auth = await getAuthToken();
    console.log(`[SETUP] Auth token obtained`);
  });

  test('Dashboard home loads after auth', async ({ loggedPage }) => {
    await loggedPage.goto(VITE_URL);
    await loggedPage.evaluate((token: string) => {
      localStorage.setItem('stas_token', token);
      localStorage.setItem('stas_refresh_token', 'test-refresh');
    }, auth.token);

    await loggedPage.actionLogger.navigate('/');
    await loggedPage.waitForLoadState('networkidle');
    await loggedPage.waitForTimeout(2000);

    const title = await loggedPage.title();
    console.log(`[INFO] Dashboard title: "${title}"`);
    expect(title).toContain('STAS');
  });

  test('No JSON parse errors on pages', async ({ loggedPage }) => {
    await loggedPage.goto(VITE_URL);
    await loggedPage.evaluate((token: string) => {
      localStorage.setItem('stas_token', token);
    }, auth.token);

    const pages = ['/', '/runs', '/analytics', '/repos', '/credits'];

    for (const pagePath of pages) {
      await loggedPage.actionLogger.navigate(pagePath);
      await loggedPage.waitForLoadState('networkidle');
      await loggedPage.waitForTimeout(2000);

      const errors = loggedPage.consoleCapture.getErrors();
      const jsonErrors = errors.filter(
        (e: any) => typeof e === 'string' && (e.includes('Unexpected token') || e.includes('JSON')),
      );

      expect(jsonErrors.length).toBe(0);
      console.log(`[OK] ${pagePath}: ${errors.length} console errors, 0 JSON parse errors`);
    }
  });

  test('API endpoints return JSON not HTML', async () => {
    const endpoints = [
      '/api/v1/runs',
      '/api/v1/credits/balance',
      '/api/v1/notifications/history?limit=5',
      '/api/v1/auth/me',
      '/api/v1/litellm/usage',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${VITE_URL}${ep}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const text = await res.text();
      const isJson = text.startsWith('{') || text.startsWith('[');

      if (!isJson) {
        console.error(`[FAIL] ${ep} returned HTML instead of JSON`);
        console.error(`  First 100 chars: ${text.slice(0, 100)}`);
      }

      expect(isJson).toBe(true);
      console.log(`[OK] ${ep}: ${res.status} (JSON)`);
    }
  });
});
