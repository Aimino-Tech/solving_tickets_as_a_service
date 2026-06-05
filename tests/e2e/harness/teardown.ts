/**
 * Global E2E test teardown.
 *
 * - Cleans up any running servers
 * - Resets environment variables
 *
 * This runs once after all E2E test files via vitest globalTeardown.
 */

export async function teardown(): Promise<void> {
  // Environment cleanup
  delete process.env.TEST;
  delete process.env.DEV_SKIP_WEBHOOK_SIGNATURE_VERIFY;
  delete process.env.GITHUB_API_URL;

  console.log('[E2E Teardown] Environment cleaned up');
}

export default teardown;
