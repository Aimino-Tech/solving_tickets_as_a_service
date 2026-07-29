import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface ScreenshotResult {
  path: string;
  label: string;
  diffPercent?: number;
  match?: boolean;
  baselinePath?: string;
}

export class ScreenshotManager {
  private baselineDir: string;
  private reportDir: string;

  constructor(
    rootDir: string,
    private testName: string,
    private threshold = 0.02,
  ) {
    this.baselineDir = path.join(rootDir, '.visbaseline');
    this.reportDir = path.join(rootDir, 'reports', testName);
    fs.mkdirSync(this.baselineDir, { recursive: true });
    fs.mkdirSync(this.reportDir, { recursive: true });
  }

  async capture(page: Page, label: string): Promise<string> {
    const ssPath = path.join(this.reportDir, `${label}.png`);
    await page.screenshot({ path: ssPath, fullPage: true });
    return ssPath;
  }

  async captureAndCompare(page: Page, label: string): Promise<ScreenshotResult> {
    const ssPath = await this.capture(page, label);
    const baselinePath = path.join(this.baselineDir, `${label}.png`);

    if (!fs.existsSync(baselinePath)) {
      fs.copyFileSync(ssPath, baselinePath);
      return {
        path: ssPath,
        label,
        match: true,
        baselinePath,
      };
    }

    const img1 = PNG.sync.read(fs.readFileSync(baselinePath));
    const img2 = PNG.sync.read(fs.readFileSync(ssPath));

    const diff = new PNG({ width: img1.width, height: img1.height });
    const diffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
      threshold: this.threshold,
    });

    const totalPixels = img1.width * img1.height;
    const diffPercent = (diffPixels / totalPixels) * 100;

    const diffPath = path.join(this.reportDir, `${label}_diff.png`);
    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    return {
      path: ssPath,
      label,
      diffPercent: Math.round(diffPercent * 100) / 100,
      match: diffPercent < 2.0,
      baselinePath,
    };
  }

  async updateBaseline(page: Page, label: string): Promise<string> {
    const ssPath = await this.capture(page, label);
    const baselinePath = path.join(this.baselineDir, `${label}.png`);
    fs.copyFileSync(ssPath, baselinePath);
    return baselinePath;
  }
}
