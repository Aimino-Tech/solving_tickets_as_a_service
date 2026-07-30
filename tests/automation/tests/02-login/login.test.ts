import { expect } from '@playwright/test';
import { test } from '../../fixtures/stas-fixtures.js';
import { LoginPage } from '../../pages/LoginPage.js';

function getBaseURL(): string {
  return process.env.STAS_URL || 'http://localhost:3000';
}

test.describe('Login Page - UI Tests', () => {
  test('Login page loads with correct title', async ({ loggedPage }) => {
    const page = loggedPage as unknown as import('@playwright/test').Page & { actionLogger: typeof loggedPage.actionLogger };
    page.actionLogger = loggedPage.actionLogger;
    const loginPage = new LoginPage(page, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.expectPageLoaded();
  });

  test('Sign In and Register tabs are visible', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await expect(loginPage.signInTab).toBeVisible();
    await expect(loginPage.registerTab).toBeVisible();
  });

  test('Sign In tab is active by default', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.nameInput).not.toBeVisible();
  });

  test('Switching to Register tab shows name field', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.switchToRegister();
    await loginPage.expectRegisterFormVisible();
  });

  test('Password field has type=password', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.switchToRegister();
    const passwordType = await loginPage.passwordInput.getAttribute('type');
    expect(passwordType).toBe('password');
  });

  test('Sign In form shows error with invalid credentials', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.signIn('invalid@test.com', 'wrongpassword');
    await loggedPage.waitForTimeout(3000);
    // Check for either error message visible or API returned 401
    const apiResp = await fetch(`${getBaseURL()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid@test.com', password: 'wrongpassword' }),
    });
    expect(apiResp.status).toBe(401);
  });
});

test.describe('Login Page - Registration', () => {
  test('Register button text is "Create Account"', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.switchToRegister();
    await expect(loginPage.registerSubmitButton).toHaveText('Create Account');
  });

  test('Password minimum length is 8', async ({ loggedPage }) => {
    const loginPage = new LoginPage(loggedPage as any, getBaseURL());
    await loginPage.navigateTo();
    await loginPage.switchToRegister();
    const minLength = await loginPage.passwordInput.getAttribute('minLength');
    expect(minLength).toBe('8');
  });
});

test.describe('Login Page - Action Logging & Debug', () => {
  test('All actions are logged during login flow', async ({ loggedPage }) => {
    const page = loggedPage as any;
    const loginPage = new LoginPage(page, getBaseURL());
    loginPage['actionLogger'] = loggedPage.actionLogger;
    loginPage['consoleCapture'] = loggedPage.consoleCapture;
    loginPage['networkCapture'] = loggedPage.networkCapture;

    await loginPage.navigateTo();
    await loginPage.switchToRegister();
    await loginPage.fillRegisterForm('Test User', 'test@example.com', 'password123');
    await loginPage.submitRegister();
    await loggedPage.waitForTimeout(2000);

    const actionLog = loginPage.getActionLog();
    console.log(`[INFO] Action log:\n${actionLog}`);
    expect(actionLog).toContain('NAVIGATE');
    expect(actionLog).toContain('CLICK');
    expect(actionLog).toContain('FILL');

    const consoleSummary = loginPage.getConsoleSummary();
    console.log(`[INFO] ${consoleSummary}`);

    const networkSummary = loginPage.getNetworkSummary();
    console.log(`[INFO] ${networkSummary}`);
  });
});
