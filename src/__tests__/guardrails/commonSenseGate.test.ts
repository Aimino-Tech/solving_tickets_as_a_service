import { describe, expect, it } from 'vitest';
import {
  runCommonSenseGate,
  validateCostBenefit,
  validateIssueContent,
  validateIssueReference,
  validatePlatformUrl,
  validateRepoName,
} from '../../guardrails/commonSenseGate.js';
import { validateBranchName, validateRepoIdentifier, validateWebhookUrl } from '../../guardrails/platformValidator.js';

describe('validatePlatformUrl', () => {
  it('accepts valid GitHub repo URLs', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo')).toEqual({
      valid: true,
      normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitHub URLs with trailing slash', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo/')).toEqual({
      valid: true,
      normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitHub URLs with .git suffix', () => {
    expect(validatePlatformUrl('github', 'https://github.com/owner/repo.git')).toEqual({
      valid: true,
      normalized: { owner: 'owner', repo: 'repo' },
    });
  });
  it('accepts valid GitLab repo URLs', () => {
    expect(validatePlatformUrl('gitlab', 'https://gitlab.com/group/project')).toEqual({
      valid: true,
      normalized: { owner: 'group', repo: 'project' },
    });
  });
  it('accepts valid GitLab nested group URLs', () => {
    expect(validatePlatformUrl('gitlab', 'https://gitlab.com/group/subgroup/project')).toEqual({
      valid: true,
      normalized: { owner: 'group/subgroup', repo: 'project' },
    });
  });
  it('accepts valid Bitbucket repo URLs', () => {
    expect(validatePlatformUrl('bitbucket', 'https://bitbucket.org/owner/repo')).toEqual({
      valid: true,
      normalized: { owner: 'owner', repo: 'repo' },
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
  it('rejects issue number 0', () => {
    expect(validateIssueReference(0).valid).toBe(false);
  });
  it('rejects negative issue numbers', () => {
    expect(validateIssueReference(-5).valid).toBe(false);
  });
  it('rejects suspiciously large issue numbers', () => {
    const r = validateIssueReference(9_000_000);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('suspiciously large');
  });
  it('rejects NaN', () => {
    expect(validateIssueReference(Number.NaN).valid).toBe(false);
  });
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
  it('rejects empty names', () => {
    expect(validateRepoName('').valid).toBe(false);
  });
  it('rejects names with spaces', () => {
    expect(validateRepoName('my repo').valid).toBe(false);
  });
  it('rejects names starting with dot', () => {
    expect(validateRepoName('.hidden').valid).toBe(false);
  });
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
  it('rejects identifiers without slash', () => {
    expect(validateRepoIdentifier('owner').valid).toBe(false);
  });
  it('rejects identifiers with empty segments', () => {
    expect(validateRepoIdentifier('/repo').valid).toBe(false);
    expect(validateRepoIdentifier('owner/').valid).toBe(false);
  });
  it('rejects identifiers with multiple slashes', () => {
    expect(validateRepoIdentifier('a/b/c').valid).toBe(false);
  });
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
  it('rejects branch names starting with dot', () => {
    expect(validateBranchName('github', '.hidden-branch').valid).toBe(false);
  });
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
  it('rejects empty branch names', () => {
    expect(validateBranchName('github', '').valid).toBe(false);
  });
  it('rejects branch names with spaces', () => {
    expect(validateBranchName('github', 'my branch').valid).toBe(false);
  });
  it('rejects branch names with control chars', () => {
    expect(validateBranchName('github', 'branch\nname').valid).toBe(false);
  });
  it('rejects refs/ prefix', () => {
    const r = validateBranchName('github', 'refs/heads/main');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('cannot start with');
  });
  it('rejects branch names ending with .lock', () => {
    expect(validateBranchName('github', 'main.lock').valid).toBe(false);
  });
  it('rejects branch names with @{ sequences', () => {
    expect(validateBranchName('github', 'branch@{1}').valid).toBe(false);
  });
  it('rejects branch names with ASCII control chars (DEL)', () => {
    expect(validateBranchName('github', 'branch\x7Fname').valid).toBe(false);
  });
});

describe('validateWebhookUrl', () => {
  it('accepts valid GitHub webhook URLs', () => {
    expect(validateWebhookUrl('github', '/webhooks/github').valid).toBe(true);
  });
  it('accepts valid GitLab webhook URLs', () => {
    expect(validateWebhookUrl('gitlab', '/webhooks/gitlab').valid).toBe(true);
  });
  it('accepts valid Bitbucket webhook URLs', () => {
    expect(validateWebhookUrl('bitbucket', '/webhooks/bitbucket').valid).toBe(true);
  });
  it('rejects GitHub webhook on wrong path', () => {
    const r = validateWebhookUrl('github', '/webhooks/gitlab');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Expected path');
  });
  it('rejects empty webhook URLs', () => {
    expect(validateWebhookUrl('github', '').valid).toBe(false);
  });
  it('rejects webhook URLs with query strings', () => {
    expect(validateWebhookUrl('github', '/webhooks/github?token=abc').valid).toBe(false);
  });
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
  it('rejects impossible issue number', () => {
    expect(validateIssueReference(Number.MAX_SAFE_INTEGER).valid).toBe(false);
  });
});

describe('validateIssueContent (AIM-4496 invariant checks)', () => {
  it('accepts ordinary fix requests', () => {
    expect(
      validateIssueContent(
        'Fix the null pointer in login',
        'When a user logs in with an empty email, the handler throws. It should return a 400.',
      ).valid,
    ).toBe(true);
  });
  it('accepts harmless mentions of package.json (adding a dependency)', () => {
    expect(
      validateIssueContent(
        'Add lodash to package.json',
        'Please install lodash so we can use it in the form validation.',
      ).valid,
    ).toBe(true);
  });
  it('rejects explicit package.json deletion', () => {
    const r = validateIssueContent(
      'Delete package.json',
      'The repo is broken, please delete package.json and start over.',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('package.json');
  });
  it('rejects lockfile deletion via rm', () => {
    const r = validateIssueContent('Remove the lockfile', 'Just rm package-lock.json, it keeps causing conflicts.');
    expect(r.valid).toBe(false);
  });
  it('rejects modifying workflow definitions', () => {
    const r = validateIssueContent('Update CI', 'Please modify workflows/ to add a deploy step.');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('workflow');
  });
  it('rejects modifying .github/workflows', () => {
    const r = validateIssueContent(
      'Change the release pipeline',
      'Edit .github/workflows/release.yml to run on merge.',
    );
    expect(r.valid).toBe(false);
  });
  it('rejects path-traversal deletion', () => {
    const r = validateIssueContent('Cleanup', 'Please rm ../other-repo/config and /etc/hosts to fix the build.');
    expect(r.valid).toBe(false);
  });
  it('accepts missing title/body (no content checks run)', () => {
    expect(validateIssueContent(undefined, null).valid).toBe(true);
  });
});

describe('validateCostBenefit (AIM-4496)', () => {
  it('accepts a specific, bounded fix request', () => {
    expect(
      validateCostBenefit(
        'Fix auth timeout',
        'The session middleware times out after 30s. Increase to 60s and add a test.',
      ).valid,
    ).toBe(true);
  });
  it('rejects empty issue content', () => {
    const r = validateCostBenefit('', '');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('no actionable content');
  });
  it('rejects near-empty content', () => {
    expect(validateCostBenefit('hi', 'x').valid).toBe(false);
  });
  it('rejects unbounded scope requests', () => {
    const r = validateCostBenefit(
      'Rewrite the entire codebase',
      'Fix everything, solve all bugs, make the whole project perfect.',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('unbounded');
  });
});

describe('runCommonSenseGate pipeline wiring (AIM-4496)', () => {
  it('passes a good issue end-to-end', () => {
    const r = runCommonSenseGate({
      platform: 'github',
      repoOwner: 'facebook',
      repoName: 'react',
      issueNumber: 42,
      title: 'Fix hook ordering warning',
      body: 'useEffect cleanup runs in the wrong order. Reorder and add a regression test.',
    });
    expect(r.passed).toBe(true);
  });
  it('rejects a bad input pre-pipeline (deleting package.json)', () => {
    const r = runCommonSenseGate({
      platform: 'github',
      repoOwner: 'facebook',
      repoName: 'react',
      issueNumber: 42,
      title: 'Delete package.json',
      body: 'The package.json is cursed. Please delete it so the build works again.',
    });
    expect(r.passed).toBe(false);
    const issueContent = r.checks.find((c) => c.check === 'issue_content');
    expect(issueContent?.valid).toBe(false);
    expect(issueContent?.error).toContain('package.json');
  });
  it('rejects a bad input pre-pipeline (workflow modification)', () => {
    const r = runCommonSenseGate({
      platform: 'github',
      repoOwner: 'facebook',
      repoName: 'react',
      issueNumber: 42,
      title: 'Add deploy to workflows/',
      body: 'modify workflows/ so releases deploy automatically.',
    });
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.check === 'issue_content')?.valid).toBe(false);
  });
  it('rejects an empty issue as a cost-benefit failure', () => {
    const r = runCommonSenseGate({
      platform: 'github',
      repoOwner: 'facebook',
      repoName: 'react',
      issueNumber: 42,
      title: '',
      body: '',
    });
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.check === 'cost_benefit')?.valid).toBe(false);
  });
});
