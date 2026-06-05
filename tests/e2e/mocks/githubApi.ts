/**
 * Mock GitHub API server for E2E tests.
 *
 * Spins up a lightweight Express server that responds to GitHub API calls
 * (PR creation, comments, refs, etc.) with controlled responses.
 *
 * Usage:
 * ```ts
 * import { createMockGitHubApiServer } from '../mocks/githubApi.js';
 * const githubApi = createMockGitHubApiServer();
 * await githubApi.start();
 *
 * // Inspect what the STAS server sent to GitHub
 * expect(githubApi.receivedRequests).toHaveLength(1);
 *
 * await githubApi.stop();
 * ```
 */

export {
  createMockGitHubApiServer,
} from '../harness/index.js';

export type { MockGitHubApiServer } from '../harness/index.js';
