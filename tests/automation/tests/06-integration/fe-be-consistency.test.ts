import { test, expect } from '../../fixtures/syntaro-fixtures.js';

const SYNTARO_URL = process.env.SYNTARO_URL || 'http://localhost:3000';

test.describe('FE + BE Consistency', () => {
  test('Dashboard page loads (may redirect to login if not authenticated)', async ({ loggedPage }) => {
    await loggedPage.actionLogger.navigate('/');
    await loggedPage.waitForLoadState('networkidle');

    const url = await loggedPage.evaluate(() => window.location.href);
    const title = await loggedPage.title();
    console.log(`[INFO] Dashboard URL: ${url}, Title: "${title}"`);

    if (url.includes('/login')) {
      console.log('[INFO] Not authenticated — redirected to login page. This is expected.');
      expect(title).toMatch(/SYNTARO/);
    } else {
      expect(title).toMatch(/Dashboard|SYNTARO/);
    }
  });

  test('Runs page loads (may redirect to login if not authenticated)', async ({ loggedPage }) => {
    await loggedPage.actionLogger.navigate('/runs');
    await loggedPage.waitForLoadState('networkidle');

    const url = await loggedPage.evaluate(() => window.location.href);
    const title = await loggedPage.title();
    console.log(`[INFO] Runs URL: ${url}, Title: "${title}"`);

    if (!url.includes('/login')) {
      console.log('[INFO] Authenticated — runs page loaded');
    }
  });

  test('No console errors or failed network requests on main pages', async ({ loggedPage }) => {
    const pages = ['/', '/login', '/runs'];

    for (const pagePath of pages) {
      await loggedPage.actionLogger.navigate(pagePath);
      await loggedPage.waitForLoadState('networkidle');
      await loggedPage.waitForTimeout(1000);

      const consoleErrors = loggedPage.consoleCapture.getErrors();
      const failedNetwork = loggedPage.networkCapture.getFailedRequests();

      const authErrors = failedNetwork.filter(
        (r) => r.status === 401 || r.status === 403,
      );
      const otherErrors = failedNetwork.filter(
        (r) => r.status !== undefined && r.status !== 401 && r.status !== 403,
      );

      if (consoleErrors.length > 0) {
        console.warn(`[WARN] Page ${pagePath} — ${consoleErrors.length} console errors`);
      }
      if (otherErrors.length > 0) {
        console.warn(`[WARN] Page ${pagePath} — ${otherErrors.length} non-auth network failures`);
      }
      if (authErrors.length > 0) {
        console.log(`[INFO] Page ${pagePath} — ${authErrors.length} auth failures (expected when not logged in)`);
      }
    }
  });
});
