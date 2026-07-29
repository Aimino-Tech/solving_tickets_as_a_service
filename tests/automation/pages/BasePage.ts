import type { Page, Locator, TestInfo } from '@playwright/test';
import { ActionLogger } from '../core/ActionLogger.js';
import { ConsoleCapture } from '../core/ConsoleCapture.js';
import { NetworkCapture } from '../core/NetworkCapture.js';

export class BasePage {
  protected actionLogger: ActionLogger;
  protected consoleCapture: ConsoleCapture;
  protected networkCapture: NetworkCapture;

  constructor(
    protected page: Page,
    protected baseURL: string,
    testInfo?: TestInfo,
    reportDir?: string,
  ) {
    const dir = reportDir || './tests/automation/reports';
    const testName = testInfo?.title || this.constructor.name;

    this.actionLogger = new ActionLogger(page, dir, testName);
    this.consoleCapture = new ConsoleCapture(page, dir, testName);
    this.networkCapture = new NetworkCapture(page, dir, testName);
  }

  async goto(url: string): Promise<void> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseURL}${url}`;
    await this.actionLogger.navigate(fullUrl);
  }

  async click(locator: Locator, description?: string): Promise<void> {
    await this.actionLogger.click(locator, description);
  }

  async fill(locator: Locator, value: string, description?: string): Promise<void> {
    await this.actionLogger.fill(locator, value, description);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    await this.actionLogger.scroll(deltaX, deltaY);
  }

  async hover(locator: Locator, description?: string): Promise<void> {
    await this.actionLogger.hover(locator, description);
  }

  async waitForLoad(state?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void> {
    await this.actionLogger.waitForLoad(state);
  }

  getActionLog(): string {
    return this.actionLogger.getActionLog();
  }

  getConsoleSummary(): string {
    return this.consoleCapture.getSummary();
  }

  getNetworkSummary(): string {
    return this.networkCapture.getSummary();
  }

  hasConsoleErrors(): boolean {
    return this.consoleCapture.hasErrors();
  }

  hasFailedNetworkRequests(): boolean {
    return this.networkCapture.hasFailedRequests();
  }

  async getPageTitle(): Promise<string> {
    return this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async isElementVisible(locator: Locator): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
