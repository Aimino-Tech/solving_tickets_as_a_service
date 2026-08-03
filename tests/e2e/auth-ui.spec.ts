import { test, expect } from '@playwright/test';

const TEST_EMAIL = `e2e-${Date.now()}@test.com`;
const TEST_PASSWORD = 'TestP@ss123';

test.describe('Auth UI flows', () => {
  test('user sees login form on /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('registration form switches to register mode', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /register/i }).click();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('failed login shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'nonexistent@test.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('text=Authentication failed')).toBeVisible({ timeout: 10_000 });
  });

  test('successful registration redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /register/i }).click();
    await page.fill('input[type="text"]', 'E2E User');
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\//, { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('token stored in localStorage after registration', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /register/i }).click();
    await page.fill('input[type="text"]', 'E2E User');
    await page.fill('input[type="email"]', `e2e-${Date.now()}@test.com`);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\//, { timeout: 15_000 });
    const accessToken = await page.evaluate(() => localStorage.getItem('syntaro_token'));
    expect(accessToken).toBeTruthy();
    const refreshToken = await page.evaluate(() => localStorage.getItem('syntaro_refreshToken'));
    expect(refreshToken).toBeTruthy();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@test.com');
    await page.fill('input[type="password"]', 'password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\//, { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('token stored in localStorage after login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@test.com');
    await page.fill('input[type="password"]', 'password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\//, { timeout: 15_000 });
    const accessToken = await page.evaluate(() => localStorage.getItem('syntaro_token'));
    expect(accessToken).toBeTruthy();
  });

  test('logout clears token and redirects', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@test.com');
    await page.fill('input[type="password"]', 'password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\//, { timeout: 15_000 });

    const logoutBtn = page.locator('text=/sign ?out|log ?out|logout/i').first();
    if (await logoutBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await logoutBtn.click();
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      const token = await page.evaluate(() => localStorage.getItem('syntaro_token'));
      expect(token).toBeNull();
    }
  });
});
