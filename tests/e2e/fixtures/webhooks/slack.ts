/**
 * Slack notification payload fixtures for E2E testing.
 *
 * Based on the Slack webhook payload shapes consumed by
 * `src/notifications/slack.ts` and the webhook handler in `src/server.ts`.
 */

/**
 * A fixture representing the data passed to SlackNotificationService.sendNotification
 * for a fix_started event.
 */
export function slackFixStartedNotification() {
  return {
    event: 'fix_started' as const,
    data: {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      botName: 'SYNTARO',
    },
  };
}

/**
 * A fixture for a pr_created notification event.
 */
export function slackPrCreatedNotification() {
  return {
    event: 'pr_created' as const,
    data: {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      botName: 'SYNTARO',
      prUrl: 'https://github.com/owner/test-repo/pull/123',
    },
  };
}

/**
 * A fixture for a fix_failed notification event.
 */
export function slackFixFailedNotification() {
  return {
    event: 'fix_failed' as const,
    data: {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      botName: 'SYNTARO',
      reason: 'Could not reproduce the issue in sandbox',
    },
  };
}

/**
 * A fixture for a verification_failed notification event.
 */
export function slackVerificationFailedNotification() {
  return {
    event: 'verification_failed' as const,
    data: {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      botName: 'SYNTARO',
      reason: 'Tests failed after fix was applied',
    },
  };
}

/**
 * A fixture for an error notification event.
 */
export function slackErrorNotification() {
  return {
    event: 'error' as const,
    data: {
      repoOwner: 'owner',
      repoName: 'test-repo',
      issueNumber: 42,
      issueTitle: 'Fix broken user login',
      botName: 'SYNTARO',
      errorMessage: 'OpenCode agent timed out after 600s',
    },
  };
}

/**
 * The expected Slack webhook POST body for a fix_started event.
 */
export function expectedSlackFixStartedText() {
  return {
    text: [
      ':mag: *SYNTARO* is investigating <https://github.com/owner/test-repo/issues/42|#42>',
      '> Fix broken user login',
      '> Repo: <https://github.com/owner/test-repo|owner/test-repo>',
    ].join('\n'),
  };
}

/**
 * The expected Slack webhook POST body for a pr_created event.
 */
export function expectedSlackPrCreatedText() {
  return {
    text: [
      ':rocket: *SYNTARO* opened a PR for <https://github.com/owner/test-repo/issues/42|#42>',
      '> Fix broken user login',
      '> Repo: <https://github.com/owner/test-repo|owner/test-repo>',
      '> PR: <https://github.com/owner/test-repo/pull/123|#123>',
    ].join('\n'),
  };
}
