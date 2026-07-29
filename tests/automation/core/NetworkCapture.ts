import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export interface NetworkEntry {
  timestamp: string;
  type: 'request' | 'response';
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodySize?: number;
  durationMs?: number;
  failure?: string;
}

export class NetworkCapture {
  private entries: NetworkEntry[] = [];
  private requestTimestamps = new Map<string, number>();
  private logDir: string;

  constructor(
    private page: Page,
    reportDir: string,
    testName: string,
  ) {
    this.logDir = path.join(reportDir, testName);
    fs.mkdirSync(this.logDir, { recursive: true });

    page.on('request', (req) => {
      this.requestTimestamps.set(req.url(), Date.now());

      const entry: NetworkEntry = {
        timestamp: new Date().toISOString(),
        type: 'request',
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        bodySize: req.postDataBuffer()?.length,
      };
      this.entries.push(entry);
      this.appendToFile(entry);
    });

    page.on('response', (resp) => {
      const startTime = this.requestTimestamps.get(resp.url());
      const durationMs = startTime ? Date.now() - startTime : undefined;

      const entry: NetworkEntry = {
        timestamp: new Date().toISOString(),
        type: 'response',
        method: resp.request().method(),
        url: resp.url(),
        status: resp.status(),
        statusText: resp.statusText(),
        headers: resp.headers(),
        bodySize: undefined,
        durationMs,
      };
      this.entries.push(entry);
      this.appendToFile(entry);
    });

    page.on('requestfailed', (req) => {
      const entry: NetworkEntry = {
        timestamp: new Date().toISOString(),
        type: 'response',
        method: req.method(),
        url: req.url(),
        failure: req.failure()?.errorText || 'unknown failure',
      };
      this.entries.push(entry);
      this.appendToFile(entry);
    });
  }

  private appendToFile(entry: NetworkEntry): void {
    const logPath = path.join(this.logDir, 'network.log');
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  }

  getEntries(): NetworkEntry[] {
    return [...this.entries];
  }

  getFailedRequests(): NetworkEntry[] {
    return this.entries.filter((e) => e.failure || (e.type === 'response' && e.status !== undefined && e.status >= 400));
  }

  hasFailedRequests(): boolean {
    return this.getFailedRequests().length > 0;
  }

  getSummary(): string {
    const totalRequests = this.entries.filter((e) => e.type === 'request').length;
    const totalResponses = this.entries.filter((e) => e.type === 'response' && e.status !== undefined);
    const failed = this.getFailedRequests().length;
    const avgDuration = totalResponses.length
      ? Math.round(totalResponses.reduce((sum, e) => sum + (e.durationMs || 0), 0) / totalResponses.length)
      : 0;
    const statusCounts: Record<number, number> = {};
    for (const e of totalResponses) {
      if (e.status !== undefined) statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
    }

    return `Network: ${totalRequests} requests, ${totalResponses.length} responses (${failed} failed), avg ${avgDuration}ms. Statuses: ${JSON.stringify(statusCounts)}`;
  }
}
