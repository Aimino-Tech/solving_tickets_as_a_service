import fs from 'node:fs';
import path from 'node:path';
import type { Page, Locator } from '@playwright/test';

export interface LoggedAction {
  step: number;
  timestamp: string;
  action: string;
  selector?: string;
  coordinates?: { x: number; y: number };
  url: string;
  title: string;
  screenshotPath?: string;
  domSnapshot?: string;
  durationMs: number;
}

export class ActionLogger {
  private actions: LoggedAction[] = [];
  private stepCounter = 0;
  private logDir: string;
  private screenshotManager: {
    capture: (page: Page, label: string) => Promise<string>;
  };

  constructor(
    private page: Page,
    reportDir: string,
    testName: string,
  ) {
    this.logDir = path.join(reportDir, testName);
    fs.mkdirSync(this.logDir, { recursive: true });
    this.screenshotManager = {
      capture: async (p: Page, label: string) => {
        const ssPath = path.join(this.logDir, `step_${this.stepCounter}_${label}.png`);
        await p.screenshot({ path: ssPath, fullPage: true });
        return ssPath;
      },
    };
  }

  async click(locator: Locator, description?: string): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const url = this.page.url();
    const title = await this.page.title();

    let selector = description;
    if (!selector) {
      try { selector = await locator.toString(); } catch { selector = 'unknown'; }
    }

    let coordinates: { x: number; y: number } | undefined;
    try {
      const box = await locator.boundingBox();
      if (box) coordinates = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    } catch {}

    let screenshotPath: string | undefined;
    try {
      screenshotPath = await this.screenshotManager.capture(this.page, `before_click_${step}`);
    } catch {}

    await locator.click();

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'click',
      selector,
      coordinates,
      url,
      title,
      screenshotPath,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async fill(locator: Locator, value: string, description?: string): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const url = this.page.url();
    const title = await this.page.title();

    let selector = description;
    if (!selector) {
      try { selector = await locator.toString(); } catch { selector = 'unknown'; }
    }

    let screenshotPath: string | undefined;
    try {
      screenshotPath = await this.screenshotManager.capture(this.page, `before_fill_${step}`);
    } catch {}

    await locator.fill(value);

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'fill',
      selector: `${selector} = "${value.slice(0, 50)}"`,
      url,
      title,
      screenshotPath,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async navigate(url: string): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const isFirstAction = this.actions.length === 0;

    let screenshotPath: string | undefined;
    if (!isFirstAction) {
      try {
        screenshotPath = await this.screenshotManager.capture(this.page, `before_navigate_${step}`);
      } catch {
        // page not ready for screenshot yet (first navigation)
      }
    }

    await this.page.goto(url, { waitUntil: 'networkidle' });

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'navigate',
      selector: url,
      url: this.page.url(),
      title: await this.page.title(),
      screenshotPath,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const url = this.page.url();
    const title = await this.page.title();

    await this.page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: deltaX, dy: deltaY });

    let screenshotPath: string | undefined;
    try {
      screenshotPath = await this.screenshotManager.capture(this.page, `after_scroll_${step}`);
    } catch {}

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'scroll',
      selector: `scrollBy(${deltaX}, ${deltaY})`,
      url,
      title,
      screenshotPath,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async hover(locator: Locator, description?: string): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const url = this.page.url();
    const title = await this.page.title();

    let selector = description;
    if (!selector) {
      try { selector = await locator.toString(); } catch { selector = 'unknown'; }
    }

    await locator.hover();

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'hover',
      selector,
      url,
      title,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async selectOption(locator: Locator, value: string | string[]): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;
    const url = this.page.url();
    const title = await this.page.title();

    await locator.selectOption(value);

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'selectOption',
      selector: `${await locator.toString()} = ${JSON.stringify(value)}`,
      url,
      title,
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  async waitForLoad(state?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void> {
    const start = Date.now();
    const step = ++this.stepCounter;

    await this.page.waitForLoadState(state || 'networkidle');

    const entry: LoggedAction = {
      step,
      timestamp: new Date().toISOString(),
      action: 'waitForLoad',
      selector: state || 'networkidle',
      url: this.page.url(),
      title: await this.page.title(),
      durationMs: Date.now() - start,
    };
    this.actions.push(entry);
    this.logEntry(entry);
  }

  getActions(): LoggedAction[] {
    return [...this.actions];
  }

  getActionLog(): string {
    return this.actions
      .map(
        (a) =>
          `[${a.timestamp}] ${a.action.toUpperCase()}${a.selector ? ` "${a.selector}"` : ''} on ${a.url} (${a.durationMs}ms)`,
      )
      .join('\n');
  }

  async captureDomSnapshot(): Promise<string> {
    const html = await this.page.content();
    const domPath = path.join(this.logDir, `dom_${++this.stepCounter}.html`);
    fs.writeFileSync(domPath, html, 'utf-8');
    return domPath;
  }

  private logEntry(entry: LoggedAction): void {
    const logPath = path.join(this.logDir, 'actions.log');
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  }
}
