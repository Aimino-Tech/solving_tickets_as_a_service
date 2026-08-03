import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/01-health',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SYNTARO_URL || 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
