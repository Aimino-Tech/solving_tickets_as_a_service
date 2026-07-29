import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class AnalyticsPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get charts(): Locator {
    return this.page.locator('.recharts-wrapper, [data-testid="chart"]');
  }

  get dateRangePicker(): Locator {
    return this.page.getByRole('button', { name: /date|range|filter/i }).first();
  }

  get exportButton(): Locator {
    return this.page.getByRole('button', { name: /export/i });
  }

  get kpiCards(): Locator {
    return this.page.locator('[data-testid="kpi-card"]');
  }

  async navigateTo(): Promise<void> {
    await this.goto('/analytics');
    await this.waitForLoad();
  }

  async getChartCount(): Promise<number> {
    return this.charts.count();
  }

  async getKpiCardCount(): Promise<number> {
    return this.kpiCards.count();
  }

  async clickExport(): Promise<void> {
    await this.click(this.exportButton, 'Export button');
  }

  async expectAnalyticsLoaded(): Promise<void> {
    await expect(this.page).toHaveTitle(/analytics|kpi/i);
  }

  async expectChartsVisible(): Promise<void> {
    const count = await this.getChartCount();
    expect(count).toBeGreaterThan(0);
  }
}
