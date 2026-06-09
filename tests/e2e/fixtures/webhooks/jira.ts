/**
 * Jira webhook payload fixtures for E2E testing.
 *
 * Based on the Jira webhook payload shapes consumed by
 * `src/trackers/jira.ts` and the webhook handler in `src/server.ts`.
 */

/**
 * Jira Issue Created — a new issue is created with a "stas:fix" label.
 */
export function jiraIssueCreated() {
  return {
    timestamp: 1714521600000,
    webhookEvent: 'jira:issue_created',
    issue_event_type_name: 'issue_created',
    user: {
      self: 'https://your-domain.atlassian.net/rest/api/3/user?accountId=user-123',
      accountId: 'user-123',
      displayName: 'Test User',
      emailAddress: 'testuser@example.com',
      active: true,
    },
    issue: {
      id: '10042',
      self: 'https://your-domain.atlassian.net/rest/api/3/issue/10042',
      key: 'PROJ-42',
      fields: {
        summary: 'Fix broken user login',
        description: {
          version: 1,
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Users are unable to log in when the password contains special characters.' }],
            },
          ],
        },
        issuetype: { id: '1', name: 'Bug', subtask: false },
        project: { id: '10000', key: 'PROJ', name: 'Project' },
        priority: { id: '2', name: 'High' },
        status: { id: '1', name: 'Open', statusCategory: { id: 2, key: 'new', colorName: 'blue' } },
        labels: ['stas:fix'],
        assignee: null,
        created: '2025-05-01T10:00:00.000+0000',
        updated: '2025-05-01T10:00:00.000+0000',
      },
    },
    changelog: null,
  };
}

/**
 * Alias for jiraIssueCreated — used by full-flow.test.ts.
 */
export const sampleJiraWebhookPayload = jiraIssueCreated;

/**
 * Jira Issue Updated — an existing issue is updated.
 */
export function jiraIssueUpdated() {
  const payload = jiraIssueCreated() as any;
  payload.webhookEvent = 'jira:issue_updated';
  payload.issue_event_type_name = 'issue_updated';
  payload.issue.fields.summary = 'Fix broken user login (updated)';
  payload.issue.fields.updated = '2025-05-01T12:00:00.000+0000';
  payload.changelog = {
    id: '200',
    items: [
      {
        field: 'description',
        fieldtype: 'jira',
        from: null,
        fromString: 'Original description',
        to: null,
        toString: 'Updated description with more details.',
      },
    ],
  };
  return payload;
}

/**
 * Jira Issue Created — without the stas:fix label (no trigger).
 */
export function jiraIssueCreatedOtherLabel() {
  const payload = jiraIssueCreated() as any;
  payload.issue.fields.labels = ['bug'];
  return payload;
}

/**
 * Jira Issue Deleted — an issue is removed.
 */
export function jiraIssueDeleted() {
  const payload = jiraIssueCreated() as any;
  payload.webhookEvent = 'jira:issue_deleted';
  payload.issue_event_type_name = 'issue_deleted';
  return payload;
}

/**
 * Alias for jiraIssueCreated — used by full-flow.test.ts
 * Returns a complete Jira issue creation webhook payload.
 */
export function sampleJiraWebhookPayload() {
  return jiraIssueCreated();
}
