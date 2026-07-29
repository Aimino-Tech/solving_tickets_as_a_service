import { defineConfig, devices } from '@playwright/test';

const STAS_URL = process.env.STAS_URL || 'http://localhost:3000';
const OSY_URL = process.env.OSY_URL || 'http://localhost:4096';
const OSY_API_KEY = process.env.OSY_API_KEY || 'test-api-key';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 1,
  reporter: [
    ['html', { outputFolder: './reports/html' }],
    ['json', { outputFile: './reports/test-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.STAS_URL || STAS_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  globalSetup: './fixtures/global-setup.ts',
  globalTeardown: './fixtures/global-teardown.ts',
});
