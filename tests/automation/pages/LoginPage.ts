import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get signInTab(): Locator {
    return this.page.getByRole('button', { name: 'Sign In' }).first();
  }

  get registerTab(): Locator {
    return this.page.getByRole('button', { name: 'Register' });
  }

  get emailInput(): Locator {
    return this.page.getByPlaceholder('you@example.com');
  }

  get passwordInput(): Locator {
    return this.page.locator('input[type="password"]');
  }

  get nameInput(): Locator {
    return this.page.getByPlaceholder('Your name');
  }

  get signInSubmitButton(): Locator {
    return this.page.locator("button[type='submit']", { hasText: 'Sign In' });
  }

  get registerSubmitButton(): Locator {
    return this.page.getByRole('button', { name: 'Create Account' });
  }

  get errorMessage(): Locator {
    return this.page.locator('[class*="text-red"]').first();
  }

  get pageTitleHeading(): Locator {
    return this.page.getByRole('heading', { name: 'SYNTARO' }).first();
  }

  async navigateTo(): Promise<void> {
    await this.goto('/login');
    await this.waitForLoad();
  }

  async switchToRegister(): Promise<void> {
    await this.click(this.registerTab, 'Register tab');
    await this.page.waitForTimeout(300);
  }

  async switchToLogin(): Promise<void> {
    await this.click(this.signInTab, 'Sign In tab');
    await this.page.waitForTimeout(300);
  }

  async fillRegisterForm(name: string, email: string, password: string): Promise<void> {
    await this.fill(this.nameInput, name, 'Name input');
    await this.fill(this.emailInput, email, 'Email input');
    await this.fill(this.passwordInput, password, 'Password input');
  }

  async submitRegister(): Promise<void> {
    await this.click(this.registerSubmitButton, 'Create Account button');
  }

  async register(name: string, email: string, password: string): Promise<void> {
    await this.switchToRegister();
    await this.fillRegisterForm(name, email, password);
    await this.submitRegister();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.switchToLogin();
    await this.fill(this.emailInput, email, 'Email input');
    await this.fill(this.passwordInput, password, 'Password input');
    await this.click(this.signInSubmitButton, 'Sign In button');
  }

  async expectLoginFormVisible(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.signInSubmitButton).toBeVisible();
  }

  async expectRegisterFormVisible(): Promise<void> {
    await expect(this.nameInput).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.registerSubmitButton).toBeVisible();
  }

  async expectPageLoaded(): Promise<void> {
    await expect(this.page).toHaveTitle(/SYNTARO/);
    await expect(this.pageTitleHeading).toBeVisible();
  }

  async expectErrorVisible(): Promise<void> {
    await expect(this.errorMessage).toBeVisible({ timeout: 10000 });
  }
}
