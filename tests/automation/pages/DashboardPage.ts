import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class DashboardPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get statsCards(): Locator {
    return this.page.locator('[data-testid="stats-card"]');
  }

  get runsLink(): Locator {
    return this.page.getByRole('link', { name: /runs/i }).first();
  }

  get analyticsLink(): Locator {
    return this.page.getByRole('link', { name: /analytics/i }).first();
  }

  get settingsLink(): Locator {
    return this.page.getByRole('link', { name: /settings/i }).first();
  }

  get userMenu(): Locator {
    return this.page.locator('[data-testid="user-menu"]');
  }

  get sidebar(): Locator {
    return this.page.locator('nav, aside').first();
  }

  async navigateTo(): Promise<void> {
    await this.goto('/dashboard');
    await this.waitForLoad();
  }

  async getStatsCardCount(): Promise<number> {
    return this.statsCards.count();
  }

  async expectDashboardLoaded(): Promise<void> {
    await expect(this.sidebar).toBeVisible({ timeout: 15000 });
    await expect(this.page).toHaveTitle(/STAS Dashboard|Dashboard/);
  }

  async navigateToRuns(): Promise<void> {
    await this.click(this.runsLink, 'Runs link in sidebar');
    await this.waitForLoad();
  }

  async navigateToAnalytics(): Promise<void> {
    await this.click(this.analyticsLink, 'Analytics link in sidebar');
    await this.waitForLoad();
  }

  async navigateToSettings(): Promise<void> {
    await this.click(this.settingsLink, 'Settings link in sidebar');
    await this.waitForLoad();
  }
}
