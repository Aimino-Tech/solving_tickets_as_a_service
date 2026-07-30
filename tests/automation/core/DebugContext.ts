import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Page, TestInfo } from '@playwright/test';
import { ActionLogger } from './ActionLogger.js';
import { ConsoleCapture } from './ConsoleCapture.js';
import { NetworkCapture } from './NetworkCapture.js';

export interface DebugBundle {
  testName: string;
  timestamp: string;
  actionLog: string;
  consoleSummary: string;
  networkSummary: string;
  screenshotCount: number;
  bundlePath: string;
}

export class DebugContext {
  private actionLogger: ActionLogger;
  private consoleCapture: ConsoleCapture;
  private networkCapture: NetworkCapture;
  private reportDir: string;

  constructor(
    private page: Page,
    private testInfo: TestInfo,
    private baseDir: string,
  ) {
    this.reportDir = path.join(baseDir, 'reports');
    const testName = this.sanitizeName(testInfo.title);

    this.actionLogger = new ActionLogger(page, this.reportDir, testName);
    this.consoleCapture = new ConsoleCapture(page, this.reportDir, testName);
    this.networkCapture = new NetworkCapture(page, this.reportDir, testName);
  }

  getActionLogger(): ActionLogger {
    return this.actionLogger;
  }

  getConsoleCapture(): ConsoleCapture {
    return this.consoleCapture;
  }

  getNetworkCapture(): NetworkCapture {
    return this.networkCapture;
  }

  async generateBundle(error?: Error): Promise<DebugBundle> {
    const testName = this.sanitizeName(this.testInfo.title);
    const bundleDir = path.join(this.reportDir, testName, 'bundle');
    fs.mkdirSync(bundleDir, { recursive: true });

    const screenshotDir = path.join(this.reportDir, testName);
    const screenshots = fs.readdirSync(screenshotDir).filter((f) => f.endsWith('.png'));

    const summary: DebugBundle = {
      testName,
      timestamp: new Date().toISOString(),
      actionLog: this.actionLogger.getActionLog(),
      consoleSummary: this.consoleCapture.getSummary(),
      networkSummary: this.networkCapture.getSummary(),
      screenshotCount: screenshots.length,
      bundlePath: '',
    };

    const summaryPath = path.join(bundleDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    if (error) {
      const errorPath = path.join(bundleDir, 'error.txt');
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack || '') : '';
      const name = error instanceof Error ? error.name : 'UnknownError';
      fs.writeFileSync(errorPath, `${name}: ${message}\n\n${stack}`);
    }

    try {
      const tracePath = path.join(bundleDir, 'trace.zip');
      await this.page.context().tracing.stop({ path: tracePath });
    } catch (e) {
      if (String(e).includes('Must start tracing')) {
        await this.page.context().tracing.start({ screenshots: true, snapshots: true });
        await this.page.context().tracing.stop({ path: tracePath });
      }
    }

    const zipPath = path.join(this.reportDir, `${testName}_debug.zip`);
    try {
      execSync(
        `cd "${this.reportDir}" && zip -r "${zipPath}" "${testName}" -x "*.zip" 2>/dev/null`,
        { stdio: 'ignore' },
      );
      summary.bundlePath = zipPath;
    } catch {
      summary.bundlePath = bundleDir;
    }

    return summary;
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  }
}
