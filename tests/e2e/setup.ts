/**
 * Global E2E test setup.
 *
 * - Sets TEST env var so config knows we're in test mode
 * - Suppresses logging during E2E tests
 * - Configures external service URLs for test environment
 *
 * This runs once before all E2E test files via vitest globalSetup.
 */

import { setupTestEnvironment } from './harness/index.js';

/**
 * Global setup: configure environment before any test runs.
 * This runs in the main process (not workers).
 */
export async function setup(): Promise<void> {
  setupTestEnvironment();
  console.log('[E2E Setup] Test environment configured');
}

export default setup;
