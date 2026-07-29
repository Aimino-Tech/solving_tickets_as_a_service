import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export interface ConsoleEntry {
  timestamp: string;
  type: string;
  text: string;
  location?: string;
  args?: string[];
}

export class ConsoleCapture {
  private entries: ConsoleEntry[] = [];
  private logDir: string;

  constructor(
    private page: Page,
    reportDir: string,
    testName: string,
  ) {
    this.logDir = path.join(reportDir, testName);
    fs.mkdirSync(this.logDir, { recursive: true });

    page.on('console', (msg) => {
      const entry: ConsoleEntry = {
        timestamp: new Date().toISOString(),
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url || undefined,
        args: msg.args().map((a) => {
          try { return a.jsonValue() as unknown as string; } catch { return String(a); }
        }),
      };
      this.entries.push(entry);
      this.appendToFile(entry);
    });

    page.on('pageerror', (err) => {
      const entry: ConsoleEntry = {
        timestamp: new Date().toISOString(),
        type: 'pageerror',
        text: err.message,
        location: err.stack,
      };
      this.entries.push(entry);
      this.appendToFile(entry);
    });
  }

  private appendToFile(entry: ConsoleEntry): void {
    const logPath = path.join(this.logDir, 'console.log');
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  }

  getEntries(): ConsoleEntry[] {
    return [...this.entries];
  }

  getErrors(): ConsoleEntry[] {
    return this.entries.filter((e) => e.type === 'error' || e.type === 'pageerror');
  }

  getWarnings(): ConsoleEntry[] {
    return this.entries.filter((e) => e.type === 'warning');
  }

  hasErrors(): boolean {
    return this.getErrors().length > 0;
  }

  getSummary(): string {
    const errors = this.getErrors().length;
    const warnings = this.getWarnings().length;
    const total = this.entries.length;
    return `Console: ${total} entries (${errors} errors, ${warnings} warnings)`;
  }
}
