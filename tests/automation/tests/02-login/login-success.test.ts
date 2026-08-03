import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage.js';

const TEST_EMAIL = 'test-automation@aimino-test.de';
const TEST_PASSWORD = 'TestAutomation123!';

function getBaseURL(): string {
  return process.env.SYNTARO_URL || 'http://localhost:3000';
}

test.describe('Successful Login', () => {
  test('logs in with real credentials, stores token, and redirects to home', async ({ page }) => {
    const loginPage = new LoginPage(page, getBaseURL());

    await loginPage.navigateTo();
    await loginPage.signIn(TEST_EMAIL, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`[INFO] URL after login: "${currentUrl}"`);

    const token = await page.evaluate(() => {
      try { return localStorage.getItem('syntaro_token'); } catch { return null; }
    });

    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThan(10);
    expect(currentUrl).not.toContain('/login');
    console.log('[PASS] Login succeeded — token stored, redirected to home');
  });

  test('all actions are logged during login flow', async ({ page }) => {
    const loginPage = new LoginPage(page, getBaseURL());

    await loginPage.navigateTo();
    await loginPage.signIn(TEST_EMAIL, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const actionLog = loginPage.getActionLog();
    console.log(`[INFO] Action log:\n${actionLog}`);
    expect(actionLog).toContain('NAVIGATE');
    expect(actionLog).toContain('CLICK');
    expect(actionLog).toContain('FILL');
  });
});
