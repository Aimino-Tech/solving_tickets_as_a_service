/**
 * Linear webhook payload fixtures for E2E testing.
 *
 * Based on the Linear webhook payload shapes consumed by
 * `src/trackers/linear.ts` and the webhook handler in `src/server.ts`.
 */

/**
 * Linear Issue Create — a new ticket is created.
 */
export function linearIssueCreate() {
  return {
    action: 'create',
    type: 'Issue',
    data: {
      id: 'linear-issue-id-1234',
      identifier: 'PROJ-42',
      title: 'Fix broken user login',
      description: 'Users are unable to log in when the password contains special characters.',
      priority: 2,
      priorityLabel: 'High',
      state: { id: 'state-id-1', name: 'Todo', type: 'unstarted' },
      assignee: { id: 'user-id-1', name: 'Test User', email: 'testuser@example.com' },
      team: { id: 'team-id-1', name: 'Engineering', key: 'PROJ' },
      labels: [{ id: 'label-id-1', name: 'syntaro:fix', color: '#fc2929' }],
      createdAt: '2025-05-01T10:00:00.000Z',
      updatedAt: '2025-05-01T10:00:00.000Z',
      url: 'https://linear.app/team/PROJ-42',
      branchName: 'proj/fix-broken-user-login',
    },
    createdAt: '2025-05-01T10:00:00.000Z',
    updatedAt: '2025-05-01T10:00:00.000Z',
  };
}

/**
 * Linear Issue Update — an existing ticket is updated.
 */
export function linearIssueUpdate() {
  const payload = linearIssueCreate() as any;
  payload.action = 'update';
  payload.data.title = 'Fix broken user login (updated)';
  payload.data.description = 'Updated description with more details.';
  payload.data.updatedAt = '2025-05-01T12:00:00.000Z';
  payload.updatedAt = '2025-05-01T12:00:00.000Z';
  return payload;
}

/**
 * Linear Issue Create — without the syntaro:fix label (no trigger).
 */
export function linearIssueCreateOtherLabel() {
  const payload = linearIssueCreate() as any;
  payload.data.labels = [{ id: 'label-id-2', name: 'bug', color: '#d73a4a' }];
  return payload;
}

/**
 * Alias for linearIssueCreate — used by full-flow.test.ts.
 */
export const sampleLinearWebhookPayload = linearIssueCreate;

/**
 * Linear Comment Create — a comment on an issue.
 */
export function linearCommentCreate() {
  return {
    action: 'create',
    type: 'Comment',
    data: {
      id: 'comment-id-5678',
      body: 'I have the same issue, please fix!',
      issue: { id: 'linear-issue-id-1234', identifier: 'PROJ-42', title: 'Fix broken user login' },
      user: { id: 'user-id-2', name: 'Commenter', email: 'commenter@example.com' },
      createdAt: '2025-05-02T08:00:00.000Z',
      updatedAt: '2025-05-02T08:00:00.000Z',
    },
    createdAt: '2025-05-02T08:00:00.000Z',
  };
}


