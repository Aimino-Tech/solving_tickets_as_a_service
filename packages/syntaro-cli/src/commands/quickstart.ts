import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import open from 'open';
import { GitHubClient } from '../utils/github.js';

const SYNTARO_APP_NAME = 'syntaro';
const CONFIG_DIR = join(homedir(), '.config', 'syntaro');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

interface SyntaroConfig {
  poweredBy?: string;
  githubToken?: string;
  installUrl?: string;
}

function loadConfig(): SyntaroConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(config: SyntaroConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    execSync(`mkdir -p "${CONFIG_DIR}"`, { stdio: 'ignore' });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...config, poweredBy: 'SYNTARO — AI bug fixes for your repo' }, null, 2));
}

function getGitHubToken(): string {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  try {
    const output = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (output) return output;
  } catch {}
  const config = loadConfig();
  if (config.githubToken) return config.githubToken;
  return '';
}

export async function quickstart(options: { skipPrompts: boolean }): Promise<void> {
  const skip = options.skipPrompts || IS_CI;
  console.log(chalk.bold.blue('\nSYNTARO Quickstart — Get your first AI-powered fix in under 60 seconds\n'));

  let token = getGitHubToken();

  if (!token) {
    if (skip) {
      console.log(chalk.red('No GitHub token found. Set GITHUB_TOKEN env var or run `gh auth login` first.'));
      process.exit(1);
    }
    const { tokenInput } = await inquirer.prompt([
      {
        type: 'input',
        name: 'tokenInput',
        message: 'Enter your GitHub personal access token (classic, with repo scope):',
        validate: (input: string) => (input.length > 0 ? true : 'Token is required'),
      },
    ]);
    token = tokenInput;
    saveConfig({ ...loadConfig(), githubToken: token });
  }

  const client = new GitHubClient(token);

  console.log(chalk.dim('Authenticating with GitHub...'));
  let user: { login: string };
  try {
    user = await client.getUser();
    console.log(chalk.green(`Authenticated as ${user.login}\n`));
  } catch {
    console.log(chalk.red('Authentication failed. Check your token and try again.'));
    process.exit(1);
  }

  console.log(chalk.dim('Fetching your repositories...'));
  const repos = await client.listAllRepos();
  const ownerRepos = repos.filter((r) => r.full_name.startsWith(`${user.login}/`));

  if (ownerRepos.length === 0) {
    console.log(chalk.yellow('No personal repositories found. Checking all accessible repos...'));
  }

  const repoChoices = (ownerRepos.length > 0 ? ownerRepos : repos).map((r) => ({
    name: `${r.full_name}${r.private ? ' (private)' : ''}`,
    value: r.full_name,
    checked: false,
  }));

  let selectedRepos: string[];

  if (skip) {
    selectedRepos = repoChoices.slice(0, 1).map((r) => r.value);
    console.log(chalk.dim(`Selected: ${selectedRepos.join(', ')}\n`));
  } else {
    const { repos: picked } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'repos',
        message: 'Select repositories to install SYNTARO on:',
        choices: repoChoices.slice(0, 20),
        validate: (input: string[]) => input.length > 0 || 'Select at least one repo',
      },
    ]);
    selectedRepos = picked;
  }

  const installUrl = `https://github.com/apps/${SYNTARO_APP_NAME}/installations/new`;

  console.log(chalk.yellow('SYNTARO app installation required.\n'));
  console.log(chalk.dim(`1. Open this URL in your browser:\n   ${chalk.underline(installUrl)}\n`));
  console.log(chalk.dim('2. Select the repositories you want SYNTARO to access'));
  console.log(chalk.dim("3. Click 'Install'"));
  console.log(chalk.dim('4. Return here when done\n'));

  if (IS_CI) {
    console.log(chalk.dim('CI mode: skipping browser open'));
  } else if (!skip) {
    const { opened } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'opened',
        message: 'Open the installation page now?',
        default: true,
      },
    ]);
    if (opened) {
      await open(installUrl);
    }
  } else {
    await open(installUrl);
  }

  if (IS_CI) {
    console.log(chalk.dim('CI mode: skipping installation wait'));
  } else if (!skip) {
    await inquirer.prompt([
      {
        type: 'confirm',
        name: 'installed',
        message: 'Did you complete the app installation?',
      },
    ]);
  } else {
    console.log(chalk.dim('Waiting 15 seconds for installation to propagate...'));
    await new Promise((r) => setTimeout(r, 15000));
  }

  const targetRepo = selectedRepos[0];
  console.log(chalk.dim(`\nCreating a test issue on ${targetRepo}...`));

  const issueBody = [
    '## Demo Issue — SYNTARO Quickstart',
    '',
    "This issue was created automatically by `npx syntaro quickstart` to demonstrate SYNTARO's capabilities.",
    '',
    '### Expected behavior',
    'SYNTARO should investigate this issue and open a pull request with a fix.',
    '',
    '### Steps to reproduce',
    '1. This is a demo issue',
    '2. SYNTARO will analyze it',
    '3. A PR will be created',
    '',
    '---',
    '_Powered by Syntaro — AI bug fixes for your repo_',
  ].join('\n');

  let issue: { number: number; html_url: string };
  try {
    issue = await client.createIssue(targetRepo, 'SYNTARO Quickstart Demo — Fix Me', issueBody, ['syntaro:fix']);
    console.log(chalk.green(`Issue created: ${issue.html_url}\n`));
  } catch (err) {
    console.log(chalk.red(`Failed to create issue: ${err.message}`));
    console.log(chalk.yellow('Make sure the repository exists and your token has repo scope.'));
    process.exit(1);
  }

  console.log(chalk.yellow('Waiting for SYNTARO to process the issue and create a PR...'));
  console.log(chalk.dim('This typically takes 30-120 seconds.\n'));

  let prUrl: string | null = null;
  const pollStart = Date.now();
  const pollTimeout = 180000;

  while (Date.now() - pollStart < pollTimeout) {
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const issueData = await client.getIssue(targetRepo, issue.number);
      const comments = await client.listIssueComments(targetRepo, issue.number);
      const prMatch = comments
        .filter((c) => c.body)
        .map((c) => c.body!.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/))
        .find(Boolean);
      if (prMatch) {
        prUrl = prMatch[0];
        break;
      }
      if (issueData.html_url !== issue.html_url) {
        prUrl = issueData.html_url;
        break;
      }
      const prs = await client.listPullRequests(targetRepo);
      const recentPr = prs.find(
        (pr) => pr.title.toLowerCase().includes('quickstart') || pr.title.toLowerCase().includes('fix me'),
      );
      if (recentPr) {
        prUrl = recentPr.html_url;
        break;
      }
      process.stdout.write('.');
    } catch {
      process.stdout.write('x');
    }
  }

  console.log();

  if (prUrl) {
    console.log(chalk.bold.green('\n✓ Quickstart complete!\n'));
    console.log(chalk.bold('Your SYNTARO fix PR:'), chalk.underline(prUrl));
    saveConfig({ ...loadConfig(), installUrl });
    console.log(chalk.dim(`\nConfig saved to ${CONFIG_PATH}`));
    console.log(chalk.dim('\nPro tip: Label any issue with `syntaro:fix` to trigger a fix automatically.\n'));
  } else {
    console.log(chalk.yellow("\nSYNTARO didn't create a PR within the timeout period.\n"));
    console.log(chalk.dim('Possible reasons:'));
    console.log(chalk.dim('  - SYNTARO app may not be installed on the selected repository'));
    console.log(chalk.dim('  - The SYNTARO backend may be processing a queue'));
    console.log(chalk.dim(`  - Check the issue at ${issue.html_url} for updates`));
    console.log(chalk.dim('\nRun `npx syntaro quickstart` again after installing the app.\n'));
  }
}
