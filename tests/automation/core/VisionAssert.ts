import type { Page } from '@playwright/test';
import { ScreenshotManager } from './ScreenshotManager.js';
import { OcrEngine } from './OcrEngine.js';
import path from 'node:path';

export class VisionAssert {
  private screenshotManager: ScreenshotManager;
  private ocrEngine: OcrEngine;

  constructor(
    private testRootDir: string,
    private testName: string,
  ) {
    this.screenshotManager = new ScreenshotManager(testRootDir, testName);
    this.ocrEngine = new OcrEngine();
  }

  async assertScreenshotMatches(page: Page, label: string, threshold = 0.02): Promise<void> {
    const result = await this.screenshotManager.captureAndCompare(page, label);
    if (!result.match) {
      throw new Error(
        `Visual mismatch for "${label}": ${result.diffPercent}% pixels differ (threshold: 2%). Diff: ${path.join(this.screenshotManager['reportDir'], `${label}_diff.png`)}`,
      );
    }
  }

  async assertTextVisible(page: Page, expectedText: string): Promise<void> {
    const ssPath = await this.screenshotManager.capture(page, `ocr_${expectedText.slice(0, 30)}`);
    const ocrResult = await this.ocrEngine.extractText(ssPath);

    if (!ocrResult.text.includes(expectedText)) {
      throw new Error(
        `Expected text "${expectedText}" not found in OCR output. Found: "${ocrResult.text.slice(0, 200)}"`,
      );
    }
  }

  async assertTextNotVisible(page: Page, unexpectedText: string): Promise<void> {
    const ssPath = await this.screenshotManager.capture(page, `ocr_no_${unexpectedText.slice(0, 30)}`);
    const ocrResult = await this.ocrEngine.extractText(ssPath);

    if (ocrResult.text.includes(unexpectedText)) {
      throw new Error(`Unexpected text "${unexpectedText}" was found in OCR output`);
    }
  }

  async getVisibleText(page: Page): Promise<string> {
    const ssPath = await this.screenshotManager.capture(page, 'ocr_full');
    const ocrResult = await this.ocrEngine.extractText(ssPath);
    return ocrResult.text;
  }

  async updateBaseline(page: Page, label: string): Promise<void> {
    await this.screenshotManager.updateBaseline(page, label);
  }
}
