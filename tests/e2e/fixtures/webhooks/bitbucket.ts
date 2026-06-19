/**
 * Bitbucket webhook payload fixtures for E2E testing.
 *
 * Based on the Bitbucket webhook payload shapes consumed by
 * `src/webhooks/bitbucket.ts`.
 */

/**
 * Bitbucket Pull Request Created — with target label in the description.
 */
export function bitbucketPullRequestCreated() {
  return {
    event: 'pullrequest:created',
    actor: {
      type: 'user',
      username: 'testuser',
      display_name: 'Test User',
      uuid: '{user-uuid-1234}',
    },
    pullrequest: {
      id: 42,
      title: 'Fix broken user login',
      description: 'This PR fixes the login issue. Label: stas:fix',
      state: 'OPEN',
      source: {
        branch: { name: 'fix/login' },
        commit: { hash: 'abc123def456' },
        repository: {
          type: 'repository',
          full_name: 'owner/test-repo',
          name: 'test-repo',
          uuid: '{repo-uuid-5678}',
          scm: 'git',
          is_private: false,
          owner: {
            username: 'owner',
            display_name: 'Owner',
            type: 'user',
            uuid: '{owner-uuid-9999}',
          },
          links: {
            self: { href: 'https://bitbucket.org/owner/test-repo' },
            html: { href: 'https://bitbucket.org/owner/test-repo' },
          },
        },
      },
      destination: {
        branch: { name: 'main' },
        commit: { hash: 'xyz789abc012' },
        repository: {
          type: 'repository',
          full_name: 'owner/test-repo',
          name: 'test-repo',
        },
      },
      links: {
        self: { href: 'https://bitbucket.org/owner/test-repo/pull-requests/42' },
        html: { href: 'https://bitbucket.org/owner/test-repo/pull-requests/42' },
      },
      created_on: '2025-05-01T10:00:00+00:00',
      updated_on: '2025-05-01T10:00:00+00:00',
      author: {
        username: 'testuser',
        display_name: 'Test User',
        type: 'user',
        uuid: '{user-uuid-1234}',
      },
    },
    repository: {
      type: 'repository',
      full_name: 'owner/test-repo',
      name: 'test-repo',
      uuid: '{repo-uuid-5678}',
      scm: 'git',
      is_private: false,
      owner: {
        username: 'owner',
        display_name: 'Owner',
        type: 'user',
        uuid: '{owner-uuid-9999}',
      },
      links: {
        self: { href: 'https://bitbucket.org/owner/test-repo' },
        html: { href: 'https://bitbucket.org/owner/test-repo' },
      },
    },
  };
}

/**
 * Bitbucket Pull Request Updated — description edited.
 */
export function bitbucketPullRequestUpdated() {
  const payload = bitbucketPullRequestCreated() as any;
  payload.event = 'pullrequest:updated';
  payload.pullrequest.updated_on = '2025-05-01T12:00:00+00:00';
  return payload;
}

/**
 * Bitbucket Repo Push — simple push event (no target label matching).
 */
export function bitbucketRepoPush() {
  return {
    event: 'repo:push',
    actor: {
      type: 'user',
      username: 'testuser',
      display_name: 'Test User',
    },
    repository: {
      type: 'repository',
      full_name: 'owner/test-repo',
      name: 'test-repo',
      is_private: false,
      owner: {
        username: 'owner',
        display_name: 'Owner',
        type: 'user',
      },
    },
    push: {
      changes: [
        {
          new: {
            type: 'branch',
            name: 'feature/something',
            target: {
              type: 'commit',
              hash: 'def789ghi012',
              date: '2025-05-01T10:00:00+00:00',
              author: { username: 'testuser', display_name: 'Test User' },
              message: 'Add new feature',
            },
          },
          old: null,
          created: true,
          forced: false,
          closed: false,
          links: {
            self: { href: 'https://bitbucket.org/owner/test-repo/commits/def789ghi012' },
            html: { href: 'https://bitbucket.org/owner/test-repo/commits/def789ghi012' },
          },
        },
      ],
    },
  };
}
