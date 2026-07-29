import { test as base, type Page, type TestInfo } from '@playwright/test';
import {
  ActionLogger,
  ConsoleCapture,
  NetworkCapture,
  DebugContext,
  OpenSymphonyClient,
  ScreenshotManager,
  VisionAssert,
} from '../core/index.js';

const TEST_ROOT = process.env.AUTOMATION_ROOT || './tests/automation';

export type LoggedPage = Page & {
  actionLogger: ActionLogger;
  consoleCapture: ConsoleCapture;
  networkCapture: NetworkCapture;
};

export const test = base.extend<{
  loggedPage: LoggedPage;
  osyClient: OpenSymphonyClient;
  debugContext: DebugContext;
  screenshotManager: ScreenshotManager;
  visionAssert: VisionAssert;
}>({
  loggedPage: async ({ page }, use, testInfo) => {
    const actionLogger = new ActionLogger(page, `${TEST_ROOT}/reports`, testInfo.title);
    const consoleCapture = new ConsoleCapture(page, `${TEST_ROOT}/reports`, testInfo.title);
    const networkCapture = new NetworkCapture(page, `${TEST_ROOT}/reports`, testInfo.title);

    const loggedPage = page as LoggedPage;
    loggedPage.actionLogger = actionLogger;
    loggedPage.consoleCapture = consoleCapture;
    loggedPage.networkCapture = networkCapture;

    await use(loggedPage);

    if (testInfo.status !== 'passed') {
      const debugContext = new DebugContext(page, testInfo, TEST_ROOT);
      const error = testInfo.errors?.[0];
      const err = error instanceof Error ? error : new Error(String(error) || 'Test failed');
      const bundle = await debugContext.generateBundle(err);
      console.log(`[DEBUG] Bundle generated: ${bundle.bundlePath}`);
    }
  },

  osyClient: async ({}, use) => {
    const client = new OpenSymphonyClient();
    await use(client);
  },

  debugContext: async ({ page }, use, testInfo) => {
    const ctx = new DebugContext(page, testInfo, TEST_ROOT);
    await use(ctx);
  },

  screenshotManager: async ({}, use, testInfo) => {
    const mgr = new ScreenshotManager(TEST_ROOT, testInfo.title);
    await use(mgr);
  },

  visionAssert: async ({}, use, testInfo) => {
    const va = new VisionAssert(TEST_ROOT, testInfo.title);
    await use(va);
  },
});

export const { describe, expect } = base;
