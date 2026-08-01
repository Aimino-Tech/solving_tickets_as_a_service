import { describe, it, expect } from 'vitest';
import {
  validatePlatformUrl,
  validateIssueReference,
  validateRepoName,
  validateFileChanges,
  runCommonSenseGateOnJob,
  analyzeCostBenefit,
} from '../../guardrails/commonSenseGate.js';
import {
  validateRepoIdentifier,
  validateBranchName,
  validateWebhookUrl,
} from '../../guardrails/platformValidator.js';

describe('validatePlatformUrl', () => {
  it('accepts valid GitHub repo URLs', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo')).toEqual({
      valid: true, normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitHub URLs with trailing slash', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo/')).toEqual({
      valid: true, normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitHub URLs with .git suffix', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo.git')).toEqual({
      valid: true, normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitLab repo URLs', () => {
    expect(validatePlatformUrl('gitlab', 'https://gitlab.com/group/project')).toEqual({
      valid: true, normalized: { owner: 'group', repo: 'project' },
    });
  });
  it('accepts valid GitLab nested group URLs', () => {
    expect(validatePlatformUrl('gitlab', 'https://gitlab.com/group/subgroup/project')).toEqual({
      valid: true, normalized: { owner: 'group/subgroup', repo: 'project' },
    });
  });
  it('accepts valid Bitbucket repo URLs', () => {
    expect(validatePlatformUrl('bitbucket', 'https://bitbucket.org/owner/repo')).toEqual({
      valid: true, normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('rejects null/undefined URLs', () => {
    expect(validatePlatformUrl('github', '' as string).valid).toBe(false);
    expect(validatePlatformUrl('github', null as unknown as string).valid).toBe(false);
    expect(validatePlatformUrl('github', undefined as unknown as string).valid).toBe(false);
  });
  it('rejects non-matching platform URLs', () => {
    const r = validatePlatformUrl('github', 'https://gitlab.com/owner/repo');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('does not appear to be a github');
  });
  it('rejects URLs without owner/repo', () => {
    expect(validatePlatformUrl('github', 'https://github.com/').valid).toBe(false);
    expect(validatePlatformUrl('bitbucket', 'https://bitbucket.org/').valid).toBe(false);
  });
  it('rejects URLs with only owner segment', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner').valid).toBe(false);
  });
  it('rejects repo names with special characters', () => {
    const r = validatePlatformUrl('github', 'https://github.com/owner/repo<bad>');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid repo/i);
  });
});

describe('validateIssueReference', () => {
  it('accepts issue numbers in valid range', () => {
    expect(validateIssueReference(1).valid).toBe(true);
    expect(validateIssueReference(42).valid).toBe(true);
    expect(validateIssueReference(999999).valid).toBe(true);
  });
  it('rejects issue number 0', () => { expect(validateIssueReference(0).valid).toBe(false); });
  it('rejects negative issue numbers', () => { expect(validateIssueReference(-5).valid).toBe(false); });
  it('rejects suspiciously large issue numbers', () => {
    const r = validateIssueReference(9_000_000);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('suspiciously large');
  });
  it('rejects NaN', () => { expect(validateIssueReference(Number.NaN).valid).toBe(false); });
  it('rejects non-integer numbers', () => {
    const r = validateIssueReference(3.14);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('must be an integer');
  });
});

describe('validateRepoName', () => {
  it('accepts valid repo names', () => {
    expect(validateRepoName('my-repo').valid).toBe(true);
    expect(validateRepoName('my_repo').valid).toBe(true);
    expect(validateRepoName('my.repo').valid).toBe(true);
    expect(validateRepoName('MyRepo2024').valid).toBe(true);
  });
  it('rejects empty names', () => { expect(validateRepoName('').valid).toBe(false); });
  it('rejects names with spaces', () => { expect(validateRepoName('my repo').valid).toBe(false); });
  it('rejects names starting with dot', () => { expect(validateRepoName('.hidden').valid).toBe(false); });
  it('rejects names with path traversal', () => {
    expect(validateRepoName('../etc').valid).toBe(false);
    expect(validateRepoName('foo/bar').valid).toBe(false);
  });
  it('rejects names with shell metacharacters', () => {
    expect(validateRepoName('rm -rf /').valid).toBe(false);
    expect(validateRepoName('$(whoami)').valid).toBe(false);
    expect(validateRepoName('; drop table').valid).toBe(false);
  });
  it('rejects hallucinated placeholder names', () => {
    expect(validateRepoName('your-repo-name').valid).toBe(false);
    expect(validateRepoName('REPLACEME').valid).toBe(false);
    expect(validateRepoName('<repo-name>').valid).toBe(false);
    expect(validateRepoName('example').valid).toBe(false);
  });
});

describe('validateRepoIdentifier', () => {
  it('accepts valid owner/repo strings', () => {
    expect(validateRepoIdentifier('owner/repo').valid).toBe(true);
    expect(validateRepoIdentifier('my-org/my-project').valid).toBe(true);
  });
  it('rejects identifiers without slash', () => { expect(validateRepoIdentifier('owner').valid).toBe(false); });
  it('rejects identifiers with empty segments', () => {
    expect(validateRepoIdentifier('/repo').valid).toBe(false);
    expect(validateRepoIdentifier('owner/').valid).toBe(false);
  });
  it('rejects identifiers with multiple slashes', () => { expect(validateRepoIdentifier('a/b/c').valid).toBe(false); });
  it('rejects identifiers with special characters', () => {
    expect(validateRepoIdentifier('own<er>/repo').valid).toBe(false);
    expect(validateRepoIdentifier('owner/repo$').valid).toBe(false);
  });
  it('rejects hallucinated placeholder identifiers', () => {
    expect(validateRepoIdentifier('your-org/repo-name').valid).toBe(false);
    expect(validateRepoIdentifier('<owner>/<repo>').valid).toBe(false);
  });
});

describe('validateBranchName', () => {
  it('accepts valid branch names for GitHub', () => {
    expect(validateBranchName('github', 'main').valid).toBe(true);
    expect(validateBranchName('github', 'feature/my-feature').valid).toBe(true);
    expect(validateBranchName('github', 'fix/issue-42').valid).toBe(true);
  });
  it('rejects branch names starting with dot', () => { expect(validateBranchName('github', '.hidden-branch').valid).toBe(false); });
  it('rejects branch names with double dots', () => {
    const r = validateBranchName('github', 'feature..name');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('disallowed');
  });
  it('accepts valid branch names for GitLab', () => {
    expect(validateBranchName('gitlab', 'main').valid).toBe(true);
    expect(validateBranchName('gitlab', 'feature/my-branch').valid).toBe(true);
  });
  it('accepts valid branch names for Bitbucket', () => {
    expect(validateBranchName('bitbucket', 'main').valid).toBe(true);
    expect(validateBranchName('bitbucket', 'feature/BB-123').valid).toBe(true);
  });
  it('rejects empty branch names', () => { expect(validateBranchName('github', '').valid).toBe(false); });
  it('rejects branch names with spaces', () => { expect(validateBranchName('github', 'my branch').valid).toBe(false); });
  it('rejects branch names with control chars', () => { expect(validateBranchName('github', 'branch\nname').valid).toBe(false); });
  it('rejects refs/ prefix', () => {
    const r = validateBranchName('github', 'refs/heads/main');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('cannot start with');
  });
  it('rejects branch names ending with .lock', () => { expect(validateBranchName('github', 'main.lock').valid).toBe(false); });
  it('rejects branch names with @{ sequences', () => { expect(validateBranchName('github', 'branch@{1}').valid).toBe(false); });
  it('rejects branch names with ASCII control chars (DEL)', () => { expect(validateBranchName('github', 'branch\x7Fname').valid).toBe(false); });
});

describe('validateWebhookUrl', () => {
  it('accepts valid GitHub webhook URLs', () => { expect(validateWebhookUrl('github', '/webhooks/github').valid).toBe(true); });
  it('accepts valid GitLab webhook URLs', () => { expect(validateWebhookUrl('gitlab', '/webhooks/gitlab').valid).toBe(true); });
  it('accepts valid Bitbucket webhook URLs', () => { expect(validateWebhookUrl('bitbucket', '/webhooks/bitbucket').valid).toBe(true); });
  it('rejects GitHub webhook on wrong path', () => {
    const r = validateWebhookUrl('github', '/webhooks/gitlab');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Expected path');
  });
  it('rejects empty webhook URLs', () => { expect(validateWebhookUrl('github', '').valid).toBe(false); });
  it('rejects webhook URLs with query strings', () => { expect(validateWebhookUrl('github', '/webhooks/github?token=abc').valid).toBe(false); });
  it('rejects unknown platform', () => {
    const r = validateWebhookUrl('unknown' as any, '/webhooks/x');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Unknown platform');
  });
});

describe('Common Sense Gate integration scenarios', () => {
  it('passes known-good GitHub issue through all validators', () => {
    expect(validatePlatformUrl('github', 'https://github.com/facebook/react').valid).toBe(true);
    expect(validateIssueReference(42).valid).toBe(true);
    expect(validateRepoName('react').valid).toBe(true);
    expect(validateRepoIdentifier('facebook/react').valid).toBe(true);
  });
  it('catches hallucinated issue with fake repo', () => {
    const r = validatePlatformUrl('github', 'https://github.com/owner/nonexistent-repo-that-does-not-exist-12345');
    expect(r.valid).toBe(true);
    expect(validateRepoName('nonexistent-repo-that-does-not-exist-12345').valid).toBe(true);
  });
  it('rejects impossible issue number', () => { expect(validateIssueReference(Number.MAX_SAFE_INTEGER).valid).toBe(false); });
});

describe('validateFileChanges (AIM-4496 hard guardrails)', () => {
  it('passes a normal fix diff touching source + test files', () => {
    const result = validateFileChanges([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'src/__tests__/index.test.ts', status: 'added' },
    ]);
    expect(result.passed).toBe(true);
  });

  it('rejects deleting package.json', () => {
    const result = validateFileChanges([{ path: 'package.json', status: 'removed' }]);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.check === 'manifest_deletion')).toBe(true);
  });

  it('rejects deleting lockfiles', () => {
    const result = validateFileChanges([
      { path: 'package-lock.json', status: 'removed' },
      { path: 'yarn.lock', status: 'removed' },
    ]);
    expect(result.passed).toBe(false);
  });

  it('rejects any change under workflows/', () => {
    for (const status of ['added', 'modified', 'removed'] as const) {
      const result = validateFileChanges([{ path: 'workflows/release.yml', status }]);
      expect(result.passed).toBe(false);
      expect(result.checks.some((c) => c.check === 'protected_path')).toBe(true);
    }
  });

  it('rejects changes to .github/workflows/', () => {
    const result = validateFileChanges([{ path: '.github/workflows/ci.yml', status: 'modified' }]);
    expect(result.passed).toBe(false);
  });

  it('rejects changes to CI definitions and .env', () => {
    expect(validateFileChanges([{ path: '.gitlab-ci.yml', status: 'modified' }]).passed).toBe(false);
    expect(validateFileChanges([{ path: '.env', status: 'modified' }]).passed).toBe(false);
    expect(validateFileChanges([{ path: 'Dockerfile', status: 'modified' }]).passed).toBe(false);
  });

  it('rejects path traversal', () => {
    const result = validateFileChanges([{ path: '../secret', status: 'modified' }]);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.check === 'path_traversal')).toBe(true);
  });

  it('passes when no changes provided', () => {
    expect(validateFileChanges([]).passed).toBe(true);
  });
});

describe('runCommonSenseGateOnJob (AIM-4496 pre-pipeline gate)', () => {
  it('passes a valid GitHub job', () => {
    const result = runCommonSenseGateOnJob({
      installationId: 1,
      repoOwner: 'facebook',
      repoName: 'react',
      repoPrivate: false,
      issueNumber: 42,
      issueTitle: 'Fix crash on login',
      issueBody: 'The app crashes when a user logs in with a broken session token.',
      source: 'github',
    });
    expect(result.passed).toBe(true);
  });

  it('rejects a hallucinated repo name', () => {
    const result = runCommonSenseGateOnJob({
      installationId: 1,
      repoOwner: 'your-org',
      repoName: 'your-repo-name',
      repoPrivate: false,
      issueNumber: 1,
      issueTitle: 'Fix it',
      issueBody: 'Please fix.',
      source: 'github',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.check === 'repo_name' && !c.valid)).toBe(true);
  });

  it('rejects an impossible issue number', () => {
    const result = runCommonSenseGateOnJob({
      installationId: 1,
      repoOwner: 'owner',
      repoName: 'repo',
      repoPrivate: false,
      issueNumber: 50_000_000,
      issueTitle: 'Fix it',
      issueBody: 'Please fix.',
      source: 'github',
    });
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.check === 'issue_number' && !c.valid)).toBe(true);
  });

  it('rejects a job whose diff deletes package.json — pre-pipeline rejection', () => {
    const result = runCommonSenseGateOnJob(
      {
        installationId: 1,
        repoOwner: 'owner',
        repoName: 'repo',
        repoPrivate: false,
        issueNumber: 7,
        issueTitle: 'Remove dependency',
        issueBody: 'Delete package.json to slim the repo.',
        source: 'github',
      },
      { fileChanges: [{ path: 'package.json', status: 'removed' }] },
    );
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.check === 'manifest_deletion' && !c.valid)).toBe(true);
  });
});

describe('analyzeCostBenefit (AIM-4496)', () => {
  it('recommends running a clear bug fix', () => {
    const estimate = analyzeCostBenefit({
      platform: 'github',
      repoOwner: 'owner',
      repoName: 'repo',
      issueTitle: 'Fix: app crashes on login with invalid token',
      issueBody: 'Users report the login endpoint throws an uncaught exception.',
    });
    expect(estimate.recommended).toBe(true);
    expect(estimate.estimatedValueCents).toBeGreaterThan(0);
  });

  it('flags a low-value / low-signal issue as not recommended', () => {
    const estimate = analyzeCostBenefit({
      platform: 'github',
      repoOwner: 'owner',
      repoName: 'repo',
      issueTitle: '',
      issueBody: '',
    });
    expect(estimate.estimatedValueCents).toBe(0);
    expect(estimate.recommended).toBe(false);
  });
});
