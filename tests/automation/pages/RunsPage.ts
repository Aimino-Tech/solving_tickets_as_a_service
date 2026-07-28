import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class RunsPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get runsTable(): Locator {
    return this.page.locator('table').first();
  }

  get runRows(): Locator {
    return this.page.locator('table tbody tr');
  }

  get searchInput(): Locator {
    return this.page.getByPlaceholder(/search|filter/i);
  }

  get statusFilter(): Locator {
    return this.page.getByRole('combobox').first();
  }

  get pagination(): Locator {
    return this.page.locator('[aria-label="pagination"], nav[aria-label*="Page"]');
  }

  async navigateTo(): Promise<void> {
    await this.goto('/dashboard/runs');
    await this.waitForLoad();
  }

  async getRunCount(): Promise<number> {
    return this.runRows.count();
  }

  async searchRuns(query: string): Promise<void> {
    await this.fill(this.searchInput, query, 'Runs search input');
    await this.waitForLoad();
  }

  async filterByStatus(status: string): Promise<void> {
    await this.selectOption(this.statusFilter, status);
    await this.waitForLoad();
  }

  async openRun(index: number): Promise<void> {
    const row = this.runRows.nth(index);
    await this.click(row, `Run row at index ${index}`);
  }

  async expectRunsPageLoaded(): Promise<void> {
    await expect(this.runsTable).toBeVisible({ timeout: 15000 });
    await expect(this.page).toHaveTitle(/runs/i);
  }

  async expectHasRuns(): Promise<void> {
    await expect(this.runRows.first()).toBeVisible({ timeout: 10000 });
  }

  private async selectOption(locator: Locator, value: string): Promise<void> {
    await locator.selectOption(value);
  }
}
