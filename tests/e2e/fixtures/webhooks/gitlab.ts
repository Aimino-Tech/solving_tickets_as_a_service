/**
 * GitLab webhook payload fixtures for E2E testing.
 *
 * Based on the GitLab webhook payload shapes consumed by
 * `src/webhooks/gitlab.ts`.
 */

/**
 * GitLab Issue Hook — issue created with a "syntaro:fix" label.
 */
export function gitlabIssueHookLabeled() {
  return {
    object_kind: 'issue',
    event_type: 'Issue Hook',
    user: {
      id: 1000,
      name: 'Test User',
      username: 'testuser',
      avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/1000/avatar.png',
      email: 'testuser@example.com',
    },
    project: {
      id: 200,
      name: 'test-repo',
      description: 'A test repository',
      web_url: 'https://gitlab.com/owner/test-repo',
      avatar_url: null,
      git_ssh_url: 'git@gitlab.com:owner/test-repo.git',
      git_http_url: 'https://gitlab.com/owner/test-repo.git',
      namespace: 'owner',
      visibility_level: 0,
      path_with_namespace: 'owner/test-repo',
      default_branch: 'main',
      ci_config_path: null,
      homepage: 'https://gitlab.com/owner/test-repo',
      url: 'git@gitlab.com:owner/test-repo.git',
      ssh_url: 'git@gitlab.com:owner/test-repo.git',
      http_url: 'https://gitlab.com/owner/test-repo.git',
    },
    object_attributes: {
      id: 300,
      title: 'Fix broken user login',
      description: 'Users are unable to log in when the password contains special characters.',
      state: 'opened',
      labels: [{ id: 400, title: 'syntaro:fix', color: '#fc2929', project_id: 200, created_at: '2025-05-01T10:00:00Z', updated_at: '2025-05-01T10:00:00Z', template: false, description: 'Trigger SYNTARO fix', type: 'ProjectLabel', priority: null }],
      milestone_id: null,
      assignee_id: null,
      author_id: 1000,
      created_at: '2025-05-01T10:00:00Z',
      updated_at: '2025-05-01T12:00:00Z',
      action: 'update',
    },
    labels: [{ id: 400, title: 'syntaro:fix', color: '#fc2929', project_id: 200, created_at: '2025-05-01T10:00:00Z', updated_at: '2025-05-01T10:00:00Z', template: false, description: 'Trigger SYNTARO fix', type: 'ProjectLabel', priority: null }],
    changes: {
      labels: {
        previous: [],
        current: [{ id: 400, title: 'syntaro:fix', color: '#fc2929', project_id: 200, created_at: '2025-05-01T10:00:00Z', updated_at: '2025-05-01T10:00:00Z', template: false, description: 'Trigger SYNTARO fix', type: 'ProjectLabel', priority: null }],
      },
    },
    repository: {
      name: 'test-repo',
      url: 'git@gitlab.com:owner/test-repo.git',
      description: 'A test repository',
      homepage: 'https://gitlab.com/owner/test-repo',
    },
  };
}

/**
 * GitLab Issue Hook — issue opened without a target label.
 */
export function gitlabIssueHookOpened() {
  const payload = gitlabIssueHookLabeled() as any;
  payload.object_attributes.labels = [];
  payload.object_attributes.action = 'open';
  payload.labels = [];
  payload.changes = {};
  return payload;
}

/**
 * GitLab Note Hook — comment on an issue.
 */
export function gitlabNoteHook() {
  return {
    object_kind: 'note',
    event_type: 'Note Hook',
    user: { id: 1000, name: 'Test User', username: 'testuser' },
    project_id: 200,
    project: {
      id: 200,
      name: 'test-repo',
      namespace: 'owner',
      path_with_namespace: 'owner/test-repo',
    },
    object_attributes: {
      id: 500,
      note: 'I have the same issue, please fix!',
      noteable_type: 'Issue',
      author_id: 1000,
      created_at: '2025-05-02T08:00:00Z',
      updated_at: '2025-05-02T08:00:00Z',
      system: false,
      noteable_id: 300,
    },
    issue: {
      id: 300,
      title: 'Fix broken user login',
      labels: [{ id: 400, title: 'syntaro:fix', color: '#fc2929' }],
    },
  };
}
