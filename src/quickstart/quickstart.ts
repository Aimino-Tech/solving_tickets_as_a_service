import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Octokit } from '@octokit/rest';

/**
 * `npx syntaro quickstart` — interactive one-shot onboarding.
 *
 * Walks a user through: GitHub token resolution, repository selection, SYNTARO
 * app installation, a demo issue tagged `syntaro:fix`, and polling for the PR
 * SYNTARO opens in response. On success it persists a config file so subsequent
 * runs skip straight to the demo.
 *
 * The behavior implemented here matches docs/quickstart.md (PR #717).
 */

export const POWERED_BY = 'SYNTARO — AI bug fixes for your repo';
export const ISSUE_TITLE = 'SYNTARO Quickstart Demo — Fix Me';
export const ISSUE_LABEL = 'syntaro:fix';
export const INSTALL_URL = 'https://github.com/apps/syntaro-bot/installations/new';

export const ISSUE_BODY = [
  'This issue was created automatically by `npx syntaro quickstart`',
  "to demonstrate SYNTARO's capabilities.",
  '',
  'Steps:',
  '1. This is a demo issue',
  '2. SYNTARO will analyze it',
  '3. A PR will be created',
  '',
  `Powered by ${POWERED_BY}`,
].join('\n');

export const DEFAULT_POLL_TIMEOUT_MS = 180_000;
export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_INSTALL_WAIT_MS = 15_000;

export interface StoredConfig {
  githubToken?: string;
  installUrl?: string;
  poweredBy?: string;
}

export interface QuickstartOptions {
  /** Non-interactive mode: fail fast on missing token, pick the first repo, skip confirmations. */
  skipPrompts?: boolean;
  /** Explicit token (bypasses resolution). */
  token?: string;
  /** Injected GitHub client (tests). */
  octokit?: Octokit;
  /** Injected token prompt (tests). */
  askToken?: () => Promise<string>;
  /** Injected interactive question prompt (tests). */
  ask?: (question: string) => Promise<string>;
  /** Injected `gh auth token` reader (tests). Returns null when unavailable. */
  getGhToken?: () => string | null;
  /** Injected delay (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injected printer (tests). */
  stdout?: (text: string) => void;
  /** Injected browser opener (tests). Defaults to openInstallPage(). */
  openPage?: () => void;
}

export interface RepoChoice {
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
}

export interface QuickstartResult {
  prUrl: string | null;
  configPath: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
}

function defaultStdout(text: string): void {
  process.stdout.write(text);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Directory holding the quickstart config. Honors SYNTARO_CONFIG_DIR for tests/CI. */
export function getConfigDir(): string {
  return process.env.SYNTARO_CONFIG_DIR ?? join(homedir(), '.config', 'syntaro');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): StoredConfig | null {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8');
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: StoredConfig): string {
  const path = getConfigPath();
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...config, poweredBy: POWERED_BY }, null, 2)}\n`, 'utf8');
  return path;
}

/** Read a GitHub token from `gh auth token`. Returns null when gh is unavailable. */
export function getGhAuthToken(): string | null {
  try {
    const token = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}

/** Resolve a GitHub token: env → `gh auth token` → stored config → prompt. */
export async function resolveGitHubToken(options: QuickstartOptions = {}): Promise<string> {
  const { skipPrompts, askToken, getGhToken = getGhAuthToken } = options;

  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (envToken !== undefined && envToken !== '') {
    return envToken;
  }

  const ghToken = getGhToken();
  if (ghToken !== null && ghToken !== '') {
    return ghToken;
  }

  const stored = loadConfig();
  if (stored?.githubToken) {
    return stored.githubToken;
  }

  if (skipPrompts) {
    throw new Error('No GitHub token found. Set GITHUB_TOKEN or run `gh auth login` first.');
  }

  const prompt = askToken ?? (async () => promptForToken());
  return prompt();
}

async function promptForToken(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Enter your GitHub personal access token: ');
    const token = answer.trim();
    if (token === '') {
      throw new Error('No GitHub token provided.');
    }
    return token;
  } finally {
    rl.close();
  }
}

async function promptForAnswer(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function createOctokit(token: string): Octokit {
  const baseUrl = process.env.GITHUB_API_URL;
  return baseUrl ? new Octokit({ auth: token, baseUrl }) : new Octokit({ auth: token });
}

/** Verify the token works. Throws when GitHub rejects it. */
export async function validateToken(octokit: Octokit): Promise<void> {
  try {
    await octokit.rest.users.getAuthenticated();
  } catch {
    throw new Error('Authentication failed. Check that your GitHub token is valid and has repo scope.');
  }
}

export async function listRepositories(octokit: Octokit): Promise<RepoChoice[]> {
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: 100,
    affiliation: 'owner,collaborator',
    sort: 'updated',
  });
  return data.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name ?? `${repo.owner.login}/${repo.name}`,
    owner: repo.owner.login,
    private: repo.private,
  }));
}

/** Interactive multi-select; `--skip-prompts` picks the first repository. */
export async function selectRepositories(repos: RepoChoice[], options: QuickstartOptions = {}): Promise<RepoChoice[]> {
  if (repos.length === 0) {
    throw new Error('No repositories found for this account. Create a repository first, then re-run quickstart.');
  }
  if (options.skipPrompts) {
    return [repos[0]];
  }

  const ask = options.ask ?? promptForAnswer;
  const stdout = options.stdout ?? defaultStdout;
  stdout('Select repositories to install SYNTARO on:\n');
  repos.forEach((repo, index) => {
    stdout(`  ${index + 1}) ${repo.fullName}${repo.private ? ' (private)' : ''}\n`);
  });
  const answer = await ask('Enter numbers (comma-separated), or "all": ');
  if (answer.toLowerCase() === 'all') {
    return repos;
  }
  const indices = answer
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= repos.length);
  if (indices.length === 0) {
    throw new Error('No repositories selected.');
  }
  return [...new Set(indices)].map((n) => repos[n - 1]);
}

/** Open the SYNTARO app installation page in the default browser. Best-effort. */
export function openInstallPage(): void {
  if (process.env.SYNTARO_OPEN_BROWSER === '0') {
    return;
  }
  const url = INSTALL_URL;
  for (const cmd of ['xdg-open', 'open']) {
    try {
      execSync(`${cmd} "${url}"`, { stdio: 'ignore' });
      return;
    } catch {
      // Try the next opener.
    }
  }
}

/**
 * Print the installation instructions and wait for the user to install the
 * app. Interactive mode asks for confirmation; `--skip-prompts` waits a fixed
 * delay for installation propagation instead.
 */
export async function installApp(options: QuickstartOptions = {}): Promise<void> {
  const { skipPrompts, ask, sleep = defaultSleep } = options;
  const stdout = options.stdout ?? defaultStdout;
  const openPage = options.openPage ?? openInstallPage;

  stdout('SYNTARO app installation required.\n\n');
  stdout('1. Open this URL in your browser:\n');
  stdout(`   ${INSTALL_URL}\n\n`);
  stdout('2. Select the repositories you want SYNTARO to access\n');
  stdout("3. Click 'Install'\n");
  stdout('4. Return here when done\n');

  if (skipPrompts) {
    openPage();
    const waitMs = envNumber('SYNTARO_INSTALL_WAIT_MS', DEFAULT_INSTALL_WAIT_MS);
    if (waitMs > 0) {
      stdout(`Waiting ${Math.round(waitMs / 1000)}s for the app installation to propagate`);
      await sleep(waitMs);
      stdout('\n');
    }
    return;
  }

  const openAnswer = await (ask ?? promptForAnswer)('? Open the installation page now? (Y/n) ');
  if (openAnswer === '' || openAnswer.toLowerCase() === 'y' || openAnswer.toLowerCase() === 'yes') {
    openPage();
  }
  await (ask ?? promptForAnswer)('Press Enter once you have installed the app... ');
}

export interface CreateTestIssueResult {
  issueNumber: number;
  issueUrl: string;
}

/** Create the demo issue tagged `syntaro:fix` on the given repository. */
export async function createTestIssue(octokit: Octokit, owner: string, repo: string): Promise<CreateTestIssueResult> {
  const { data: issue } = await octokit.rest.issues.create({
    owner,
    repo,
    title: ISSUE_TITLE,
    body: ISSUE_BODY,
  });
  try {
    await octokit.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels: [ISSUE_LABEL] });
  } catch {
    // The `syntaro:fix` label may not exist yet on repos that never used SYNTARO.
    // The issue itself still triggers the pipeline when the app is installed.
  }
  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url ?? `https://github.com/${owner}/${repo}/issues/${issue.number}`,
  };
}

const PR_URL_PATTERN = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;

/**
 * Poll GitHub until SYNTARO opens a PR for the demo issue.
 *
 * A PR counts as found when (a) a comment on the issue contains a PR URL, or
 * (b) a pull request whose title matches "quickstart" or "fix me" exists.
 * Returns the PR URL, or null once the timeout elapses.
 */
export async function pollForPrUrl(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  options: QuickstartOptions = {},
): Promise<string | null> {
  const sleep = options.sleep ?? defaultSleep;
  const stdout = options.stdout ?? defaultStdout;
  const timeoutMs = envNumber('SYNTARO_TIMEOUT_MS', DEFAULT_POLL_TIMEOUT_MS);
  const intervalMs = envNumber('SYNTARO_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromComments = await findPrUrlInComments(octokit, owner, repo, issueNumber);
    if (fromComments !== null) {
      return fromComments;
    }
    const fromPulls = await findMatchingPr(octokit, owner, repo);
    if (fromPulls !== null) {
      return fromPulls;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    stdout('.');
    await sleep(Math.min(intervalMs, remaining));
  }
  stdout('\n');
  return null;
}

async function findPrUrlInComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string | null> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 50,
  });
  for (const comment of comments) {
    if (comment.body === null || comment.body === undefined) {
      continue;
    }
    const match = comment.body.match(PR_URL_PATTERN);
    if (match !== null) {
      return match[0];
    }
  }
  return null;
}

async function findMatchingPr(octokit: Octokit, owner: string, repo: string): Promise<string | null> {
  const { data: pulls } = await octokit.rest.pulls.list({ owner, repo, state: 'open', per_page: 30 });
  for (const pull of pulls) {
    if (/quickstart|fix me/i.test(pull.title)) {
      return pull.html_url ?? `https://github.com/${owner}/${repo}/pull/${pull.number}`;
    }
  }
  return null;
}

export interface RunQuickstartOptions extends QuickstartOptions {
  /** Seconds to wait for the app install before the first poll (0 disables). */
}

/**
 * Run the full quickstart walkthrough. Returns the PR URL (or null on
 * timeout) together with the persisted config path.
 */
export async function runQuickstart(options: RunQuickstartOptions = {}): Promise<QuickstartResult> {
  const stdout = options.stdout ?? defaultStdout;
  const token = options.token ?? (await resolveGitHubToken(options));
  const octokit = options.octokit ?? createOctokit(token);

  await validateToken(octokit);

  const repos = await listRepositories(octokit);
  const selected = await selectRepositories(repos, options);
  const { owner, name: repo } = selected[0];

  await installApp(options);

  const { issueNumber, issueUrl } = await createTestIssue(octokit, owner, repo);
  stdout(`Created demo issue: ${issueUrl}\n`);
  stdout(`Waiting for SYNTARO to fix it`);

  const configPath = saveConfig({ githubToken: token, installUrl: INSTALL_URL });
  stdout(`\nConfig saved to ${configPath}\n`);

  const prUrl = await pollForPrUrl(octokit, owner, repo, issueNumber, options);
  return { prUrl, configPath, owner, repo, issueNumber, issueUrl };
}
