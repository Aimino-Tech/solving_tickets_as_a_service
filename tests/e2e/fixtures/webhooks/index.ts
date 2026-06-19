/**
 * Webhook fixture index — re-exports all fixture functions.
 *
 * Usage:
 * ```ts
 * import { githubIssuesLabeledStasFix, gitlabIssueHookLabeled } from './fixtures/webhooks/index.js';
 * ```
 */

export * from './github.js';
export * from './gitlab.js';
export * from './bitbucket.js';
export * from './linear.js';
export * from './jira.js';
export * from './slack.js';
