import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestIssue,
  getConfigPath,
  INSTALL_URL,
  ISSUE_LABEL,
  ISSUE_TITLE,
  loadConfig,
  POWERED_BY,
  pollForPrUrl,
  resolveGitHubToken,
  runQuickstart,
  saveConfig,
} from '../../quickstart/quickstart.js';

function makeFakeOctokit() {
  return {
    rest: {
      users: {
        getAuthenticated: vi.fn().mockResolvedValue({ data: { login: 'alice' } }),
      },
      repos: {
        listForAuthenticatedUser: vi.fn().mockResolvedValue({
          data: [
            { name: 'awesome-project', full_name: 'alice/awesome-project', owner: { login: 'alice' }, private: false },
            { name: 'secret-tool', full_name: 'alice/secret-tool', owner: { login: 'alice' }, private: true },
          ],
        }),
      },
      issues: {
        create: vi.fn().mockResolvedValue({
          data: { number: 3, html_url: 'https://github.com/alice/awesome-project/issues/3' },
        }),
        addLabels: vi.fn().mockResolvedValue({ data: [] }),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  };
}

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function asOctokit(fake: FakeOctokit): Octokit {
  return fake as unknown as Octokit;
}

function noopSleep(): Promise<void> {
  return Promise.resolve();
}

let tempDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'syntaro-quickstart-test-'));
  savedEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    SYNTARO_CONFIG_DIR: process.env.SYNTARO_CONFIG_DIR,
    SYNTARO_OPEN_BROWSER: process.env.SYNTARO_OPEN_BROWSER,
    SYNTARO_TIMEOUT_MS: process.env.SYNTARO_TIMEOUT_MS,
    SYNTARO_POLL_INTERVAL_MS: process.env.SYNTARO_POLL_INTERVAL_MS,
    SYNTARO_INSTALL_WAIT_MS: process.env.SYNTARO_INSTALL_WAIT_MS,
    GITHUB_API_URL: process.env.GITHUB_API_URL,
  };
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_API_URL;
  process.env.SYNTARO_CONFIG_DIR = join(tempDir, 'config');
  process.env.SYNTARO_OPEN_BROWSER = '0';
  process.env.SYNTARO_TIMEOUT_MS = '50';
  process.env.SYNTARO_POLL_INTERVAL_MS = '5';
  process.env.SYNTARO_INSTALL_WAIT_MS = '0';
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('quickstart config', () => {
  it('saveConfig writes poweredBy and loadConfig roundtrips', () => {
    const configPath = saveConfig({ githubToken: 'ghp_abc', installUrl: INSTALL_URL });

    expect(configPath).toBe(getConfigPath());
    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, string>;
    expect(parsed.githubToken).toBe('ghp_abc');
    expect(parsed.installUrl).toBe(INSTALL_URL);
    expect(parsed.poweredBy).toBe(POWERED_BY);

    expect(loadConfig()).toEqual({
      githubToken: 'ghp_abc',
      installUrl: INSTALL_URL,
      poweredBy: POWERED_BY,
    });
  });

  it('loadConfig returns null when no config exists', () => {
    expect(loadConfig()).toBeNull();
  });
});

describe('resolveGitHubToken', () => {
  it('fails fast on a fresh environment in skip-prompts mode', async () => {
    await expect(resolveGitHubToken({ skipPrompts: true, getGhToken: () => null })).rejects.toThrow(
      'No GitHub token found',
    );
  });

  it('prompts interactively when no token source exists', async () => {
    const token = await resolveGitHubToken({
      getGhToken: () => null,
      askToken: async () => 'ghp_prompted',
    });
    expect(token).toBe('ghp_prompted');
  });

  it('prefers the env var over gh and config', async () => {
    process.env.GITHUB_TOKEN = 'ghp_env';
    saveConfig({ githubToken: 'ghp_config' });
    const token = await resolveGitHubToken({ getGhToken: () => 'ghp_gh' });
    expect(token).toBe('ghp_env');
  });

  it('prefers gh auth token over the stored config', async () => {
    saveConfig({ githubToken: 'ghp_config' });
    const token = await resolveGitHubToken({ getGhToken: () => 'ghp_gh' });
    expect(token).toBe('ghp_gh');
  });

  it('falls back to the stored config token', async () => {
    saveConfig({ githubToken: 'ghp_config' });
    const token = await resolveGitHubToken({ getGhToken: () => null });
    expect(token).toBe('ghp_config');
  });
});

describe('createTestIssue', () => {
  it('creates the demo issue with the syntaro:fix label', async () => {
    const fake = makeFakeOctokit();
    const result = await createTestIssue(asOctokit(fake), 'alice', 'awesome-project');

    expect(fake.rest.issues.create).toHaveBeenCalledWith({
      owner: 'alice',
      repo: 'awesome-project',
      title: ISSUE_TITLE,
      body: expect.stringContaining(POWERED_BY),
    });
    expect(fake.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'alice',
      repo: 'awesome-project',
      issue_number: 3,
      labels: [ISSUE_LABEL],
    });
    expect(result).toEqual({
      issueNumber: 3,
      issueUrl: 'https://github.com/alice/awesome-project/issues/3',
    });
  });

  it('still succeeds when the label does not exist yet', async () => {
    const fake = makeFakeOctokit();
    fake.rest.issues.addLabels.mockRejectedValue(new Error('Label does not exist'));

    const result = await createTestIssue(asOctokit(fake), 'alice', 'awesome-project');
    expect(result.issueNumber).toBe(3);
  });
});

describe('pollForPrUrl', () => {
  it('returns the PR URL from an issue comment', async () => {
    const fake = makeFakeOctokit();
    fake.rest.issues.listComments.mockResolvedValue({
      data: [{ body: 'SYNTARO opened https://github.com/alice/awesome-project/pull/42 to fix this' }],
    });

    const url = await pollForPrUrl(asOctokit(fake), 'alice', 'awesome-project', 3, {
      sleep: noopSleep,
      stdout: () => {},
    });
    expect(url).toBe('https://github.com/alice/awesome-project/pull/42');
  });

  it('returns the PR URL from a matching pull request title', async () => {
    const fake = makeFakeOctokit();
    fake.rest.pulls.list.mockResolvedValue({
      data: [{ title: 'Fix me: quickstart demo issue', html_url: 'https://github.com/alice/awesome-project/pull/9' }],
    });

    const url = await pollForPrUrl(asOctokit(fake), 'alice', 'awesome-project', 3, {
      sleep: noopSleep,
      stdout: () => {},
    });
    expect(url).toBe('https://github.com/alice/awesome-project/pull/9');
  });

  it('returns null when the timeout elapses without a PR', async () => {
    const fake = makeFakeOctokit();

    const url = await pollForPrUrl(asOctokit(fake), 'alice', 'awesome-project', 3, {
      sleep: noopSleep,
      stdout: () => {},
    });
    expect(url).toBeNull();
    expect(fake.rest.issues.listComments).toHaveBeenCalled();
    expect(fake.rest.pulls.list).toHaveBeenCalled();
  });
});

describe('runQuickstart', () => {
  it('runs the full flow and persists the config with poweredBy', async () => {
    process.env.GITHUB_TOKEN = 'ghp_e2e';
    const fake = makeFakeOctokit();
    fake.rest.issues.listComments.mockResolvedValue({
      data: [{ body: 'Fixed in https://github.com/alice/awesome-project/pull/5' }],
    });

    const result = await runQuickstart({
      skipPrompts: true,
      octokit: asOctokit(fake),
      sleep: noopSleep,
      stdout: () => {},
      openPage: () => {},
    });

    expect(fake.rest.users.getAuthenticated).toHaveBeenCalled();
    expect(fake.rest.repos.listForAuthenticatedUser).toHaveBeenCalled();
    expect(fake.rest.issues.create).toHaveBeenCalledWith({
      owner: 'alice',
      repo: 'awesome-project',
      title: ISSUE_TITLE,
      body: expect.stringContaining(POWERED_BY),
    });
    expect(result.prUrl).toBe('https://github.com/alice/awesome-project/pull/5');
    expect(result.owner).toBe('alice');
    expect(result.repo).toBe('awesome-project');

    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8')) as Record<string, string>;
    expect(parsed.githubToken).toBe('ghp_e2e');
    expect(parsed.installUrl).toBe(INSTALL_URL);
    expect(parsed.poweredBy).toBe(POWERED_BY);
  });
});

describe('createTestIssue body', () => {
  it('creates an issue body that mentions poweredBy', async () => {
    const fake = makeFakeOctokit();
    await createTestIssue(asOctokit(fake), 'alice', 'awesome-project');
    const body = fake.rest.issues.create.mock.calls[0][0].body as string;
    expect(body).toContain('This issue was created automatically by `npx syntaro quickstart`');
    expect(body).toContain(POWERED_BY);
  });
});
