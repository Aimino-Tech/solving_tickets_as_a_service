import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class RunDetailPage extends BasePage {
  constructor(page: Page, baseURL: string) {
    super(page, baseURL);
  }

  get runTitle(): Locator {
    return this.page.locator('h1').first();
  }

  get runStatus(): Locator {
    return this.page.locator('[data-testid="run-status"]');
  }

  get runSummary(): Locator {
    return this.page.locator('[data-testid="run-summary"]');
  }

  get runLogs(): Locator {
    return this.page.locator('[data-testid="run-logs"], pre, code');
  }

  get prLink(): Locator {
    return this.page.getByRole('link', { name: /pull request|pr/i });
  }

  get retryButton(): Locator {
    return this.page.getByRole('button', { name: /retry|rerun/i });
  }

  async navigateTo(runId: string): Promise<void> {
    await this.goto(`/runs/${runId}`);
    await this.waitForLoad();
  }

  async getStatus(): Promise<string | null> {
    return this.runStatus.textContent();
  }

  async expectRunDetailLoaded(): Promise<void> {
    await expect(this.runTitle).toBeVisible({ timeout: 15000 });
  }

  async expectStatus(expected: string): Promise<void> {
    await expect(this.runStatus).toContainText(expected, { timeout: 10000 });
  }

  async expectPrLinkVisible(): Promise<void> {
    if (await this.prLink.isVisible()) {
      await expect(this.prLink).toBeVisible();
    }
  }

  async clickRetry(): Promise<void> {
    if (await this.retryButton.isVisible()) {
      await this.click(this.retryButton, 'Retry button');
      await this.waitForLoad();
    }
  }
}
