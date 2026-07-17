/**
 * AIM-3210: Test GitHub App Configuration
 *
 * Provides a mock GitHub App configuration for E2E testing.
 * This simulates the GitHub App setup that would be configured
 * in a sandbox organization for testing purposes.
 *
 * Usage:
 * ```ts
 * import { createTestGitHubAppConfig } from './harness/github-app-config.js';
 * const appConfig = createTestGitHubAppConfig();
 * ```
 */

export interface TestGitHubAppConfig {
  appId: string;
  appName: string;
  webhookSecret: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  installationId: number;
  owner: string;
  repo: string;
  permissions: {
    issues: string;
    pullRequests: string;
    contents: string;
    metadata: string;
  };
  events: string[];
}

/**
 * Create a test GitHub App configuration with sandbox defaults.
 * These values are for E2E testing only and should not be used in production.
 */
export function createTestGitHubAppConfig(
  overrides?: Partial<TestGitHubAppConfig>,
): TestGitHubAppConfig {
  return {
    appId: '999999',
    appName: 'stas-test-bot',
    webhookSecret: 'test-webhook-secret',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMOCK_PRIVATE_KEY_FOR_TESTING\n-----END RSA PRIVATE KEY-----',
    clientId: 'Iv1.test-client-id',
    clientSecret: 'test-client-secret',
    installationId: 555,
    owner: 'sandbox-org',
    repo: 'stas-e2e-test-repo',
    permissions: {
      issues: 'write',
      pullRequests: 'write',
      contents: 'write',
      metadata: 'read',
    },
    events: [
      'issues',
      'issue_comment',
      'pull_request',
      'marketplace_purchase',
    ],
    ...overrides,
  };
}

/**
 * Create environment variables for the test GitHub App.
 */
export function createGitHubAppEnvVars(
  config?: Partial<TestGitHubAppConfig>,
): Record<string, string> {
  const appConfig = createTestGitHubAppConfig(config);
  return {
    GITHUB_APP_ID: appConfig.appId,
    GITHUB_APP_NAME: appConfig.appName,
    GITHUB_WEBHOOK_SECRET: appConfig.webhookSecret,
    GITHUB_APP_PRIVATE_KEY: appConfig.privateKey,
    GITHUB_CLIENT_ID: appConfig.clientId,
    GITHUB_CLIENT_SECRET: appConfig.clientSecret,
    TRACKER_INSTALLATION_ID: String(appConfig.installationId),
    TRACKER_DEFAULT_REPO_OWNER: appConfig.owner,
    TRACKER_DEFAULT_REPO_NAME: appConfig.repo,
  };
}
