import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class SettingsPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get apiKeySection(): Locator {
    return this.page.locator('[data-testid="api-keys-section"]');
  }

  get generateApiKeyButton(): Locator {
    return this.page.getByRole('button', { name: /generate|create.*key/i });
  }

  get notificationToggles(): Locator {
    return this.page.locator('[role="switch"], input[type="checkbox"]');
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: /save|update/i });
  }

  get successMessage(): Locator {
    return this.page.locator('[data-testid="success-message"], [role="alert"]').first();
  }

  async navigateTo(): Promise<void> {
    await this.goto('/settings');
    await this.waitForLoad();
  }

  async toggleNotification(index: number): Promise<void> {
    const toggle = this.notificationToggles.nth(index);
    await this.click(toggle, `Notification toggle at index ${index}`);
  }

  async clickSave(): Promise<void> {
    await this.click(this.saveButton, 'Save settings button');
  }

  async expectSettingsLoaded(): Promise<void> {
    await expect(this.page).toHaveTitle(/settings/i);
  }

  async expectSaveSuccess(): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 10000 });
  }
}
