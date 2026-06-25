/**
 * Test issue trigger for onboarding verification.
 *
 * Creates a test issue in the configured repository via the GitHub API,
 * labels it with `stas:fix`, and posts a comment explaining it's a test run.
 * Returns the issue URL for the wizard to display to the user.
 *
 * ── Error Handling Audit ────────────────────────────────────────────
 * ✅ Missing installation token logs and returns friendly error
 * ✅ GitHub API failures caught with context
 * ✅ Issue creation success propagates URL for dashboard display
 * ────────────────────────────────────────────────────────────────────
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding-test-run' });

export interface TestRunResult {
  /** URL of the created test issue */
  issueUrl: string;
  /** Issue number that was created */
  issueNumber: number;
  /** Name of the repo where the issue was created */
  repoName: string;
  /** Owner of the repo where the issue was created */
  repoOwner: string;
  /** The installation ID used */
  installationId: number;
}

/**
 * Trigger a test run by creating a test issue via the GitHub API.
 *
 * @param installationId - GitHub App installation ID
 * @param repo - Repository name
 * @param owner - Repository owner (user or org)
 * @param labels - Optional labels to apply (defaults to config.stas.label)
 * @returns TestRunResult with the issue URL
 */
export async function triggerTestRun(
  installationId: number,
  repo: string,
  owner: string,
  labels?: string[],
): Promise<TestRunResult> {
  const triggerLabel = labels?.[0] ?? config.stas.label;
  const testIssueTitle = config.onboarding?.testIssueTitle ?? 'STAS Onboarding Test Issue';
  const testIssueBody = [
    '## STAS Onboarding Test Issue',
    '',
    'This is an automated test issue created during the STAS onboarding wizard.',
    'It verifies that STAS is properly configured to receive and process issues.',
    '',
    '**What should happen:**',
    '1. STAS will detect the label on this issue',
    '2. It will investigate and attempt to produce a fix',
    '3. A draft PR will be created (or you\'ll see an error comment)',
    '',
    '**This is a test — no actual code changes are expected.**',
    '',
    '---',
    '',
    '_This issue was automatically created by the STAS onboarding wizard._',
  ].join('\n');

  log.info(
    { installationId, owner, repo, label: triggerLabel },
    'Triggering onboarding test run',
  );

  // Get a GitHub App installation token
  let token: string;
  try {
    const { getInstallationToken } = await import('../github/auth.js');
    token = await getInstallationToken(installationId);
  } catch (err) {
    log.error(
      { err: String(err), installationId },
      'Failed to get GitHub installation token for test run',
    );
    throw new Error(
      'Could not authenticate with GitHub. Please ensure the GitHub App is properly installed.',
    );
  }

  // Create the test issue
  let issueData: { html_url: string; number: number };
  try {
    const createRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          title: testIssueTitle,
          body: testIssueBody,
          labels: [triggerLabel],
        }),
      },
    );

    if (!createRes.ok) {
      const errorText = await createRes.text();
      log.error(
        { status: createRes.status, error: errorText, owner, repo },
        'Failed to create test issue',
      );

      if (createRes.status === 403) {
        throw new Error(
          'GitHub API returned a 403 error. ' +
          'The GitHub App may not have permission to create issues in this repository. ' +
          'Please check the App permissions.',
        );
      } else if (createRes.status === 404) {
        throw new Error(
          `Repository "${owner}/${repo}" was not found. ` +
          'Please verify the repository exists and the GitHub App is installed on it.',
        );
      }

      throw new Error(
        `Failed to create test issue in ${owner}/${repo}. ` +
        `GitHub API responded with: ${createRes.status}. Please try again.`,
      );
    }

    issueData = (await createRes.json()) as { html_url: string; number: number };
  } catch (err) {
    if (err instanceof Error && err.message.includes('GitHub API returned')) {
      throw err; // Re-throw our friendly errors
    }
    log.error(
      { err: String(err), owner, repo },
      'Unexpected error creating test issue',
    );
    throw new Error(
      `An unexpected error occurred while creating the test issue in ${owner}/${repo}. Please try again.`,
    );
  }

  // Post a comment explaining the test run
  try {
    const commentBody = [
      '> [!NOTE]',
      '> **This is a STAS onboarding test issue**',
      '>',
      '> STAS is verifying its configuration by creating this test issue.',
      '> Once labeled, STAS will process this issue and attempt to create a fix PR.',
      '>',
      '> No action is required. You can close this issue after the process completes.',
    ].join('\n');

    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueData.number}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({ body: commentBody }),
      },
    );
  } catch (err) {
    // Non-fatal — issue was created successfully
    log.warn(
      { err: String(err), owner, repo, issueNumber: issueData.number },
      'Failed to post comment on test issue',
    );
  }

  log.info(
    { issueUrl: issueData.html_url, issueNumber: issueData.number, owner, repo },
    'Test issue created successfully',
  );

  return {
    issueUrl: issueData.html_url,
    issueNumber: issueData.number,
    repoName: repo,
    repoOwner: owner,
    installationId,
  };
}
