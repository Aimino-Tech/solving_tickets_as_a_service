/**
 * GitGuard — Block destructive git operations in agent sandboxes.
 *
 * STAS auto-creates PRs from agent outputs. If the agent runs
 * `git push --force`, `git branch -D`, or `git reset --hard`,
 * it can destroy branch history and corrupt the PR.
 *
 * This guard intercepts git commands and blocks dangerous ones
 * before they reach the real git binary.
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'git-guard' });

/** Git commands that are NEVER allowed (destructive). */
const BLOCKED_GIT_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /git\s+push\s+.*--force/gi, reason: 'Force push would overwrite remote history' },
  { pattern: /git\s+branch\s+-[dD]/gi, reason: 'Branch deletion would remove work' },
  { pattern: /git\s+reset\s+--hard/gi, reason: 'Hard reset would discard uncommitted changes' },
  { pattern: /git\s+rebase\s+--(force|onto)/gi, reason: 'Force rebase would rewrite history' },
  { pattern: /git\s+gc\s+--prune/gi, reason: 'GC prune would remove unreachable objects' },
  { pattern: /git\s+clean\s+-(f|fd|df)/gi, reason: 'Force clean would delete untracked files' },
  { pattern: /git\s+update-ref\s+-d/gi, reason: 'Delete ref would corrupt branch state' },
  { pattern: /git\s+checkout\s+--\s*\./gi, reason: 'Discard all changes would destroy work' },
  { pattern: /git\s+rm\s+-r\s+--cached/gi, reason: 'Recursive rm cached would corrupt index' },
  { pattern: /git\s+filter-branch/gi, reason: 'Filter-branch would rewrite entire history' },
];

/** Git commands that are ALWAYS allowed. */
const ALLOWED_GIT_PREFIXES = [
  'git add',
  'git commit',
  'git push',
  'git checkout',
  'git log',
  'git diff',
  'git status',
  'git config',
  'git remote',
  'git branch',
  'git clone',
  'git fetch',
  'git pull',
  'git merge',
  'git stash',
  'git tag',
  'git show',
  'git describe',
  'git rev-parse',
  'git rev-list',
  'git shortlog',
  'git blame',
  'git grep',
  'git ls-files',
  'git mv',
  'git restore',
  'git worktree',
  'git submodule',
  'git init',
];

export interface GitGuardResult {
  allowed: boolean;
  command: string;
  reason?: string;
  sanitized?: string;
}

/**
 * Validate a git command and block destructive operations.
 */
export function checkGitCommand(command: string): GitGuardResult {
  // Only intercept git commands
  if (!command.trim().toLowerCase().startsWith('git ')) {
    return { allowed: true, command };
  }

  const trimmed = command.trim();

  // Check blocked patterns first (these are always blocked)
  for (const { pattern, reason } of BLOCKED_GIT_COMMANDS) {
    if (pattern.test(trimmed)) {
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
  }

  // Extract the git subcommand
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { allowed: true, command: trimmed };
  }

  const subcommand = parts[1];

  // For `git push`, extra validation — ensure no --force flag
  if (subcommand === 'push') {
    const hasForceFlag = trimmed.includes('--force') || trimmed.includes('-f');
    if (hasForceFlag) {
      const reason = 'Force push would overwrite remote history';
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
    return { allowed: true, command: trimmed };
  }

  // For `git checkout`, extra validation — ensure no -- . (discard all)
  if (subcommand === 'checkout') {
    if (/checkout\s+--\s*\./.test(trimmed)) {
      const reason = 'Discard all changes would destroy work';
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
    return { allowed: true, command: trimmed };
  }

  // For `git branch`, extra validation — ensure no -d or -D flag
  if (subcommand === 'branch') {
    const hasDeleteFlag = /\s+-[dD]/.test(trimmed);
    if (hasDeleteFlag) {
      const reason = 'Branch deletion would remove work';
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
    return { allowed: true, command: trimmed };
  }

  // For `git reset`, extra validation — ensure no --hard
  if (subcommand === 'reset') {
    if (trimmed.includes('--hard')) {
      const reason = 'Hard reset would discard uncommitted changes';
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
    return { allowed: true, command: trimmed };
  }

  // For `git rebase`, block force variants
  if (subcommand === 'rebase') {
    if (trimmed.includes('--force') || trimmed.includes('--onto')) {
      const reason = 'Force rebase would rewrite history';
      log.warn({ command: trimmed, reason }, 'Blocked destructive git command');
      return { allowed: false, command: trimmed, reason };
    }
    return { allowed: true, command: trimmed };
  }

  // Check if the subcommand is in the allowed prefixes list
  const isAllowed = ALLOWED_GIT_PREFIXES.some((prefix) => {
    const prefixParts = prefix.split(/\s+/);
    return parts.slice(0, prefixParts.length).join(' ') === prefix;
  });

  if (isAllowed) {
    return { allowed: true, command: trimmed };
  }

  // Unknown git subcommand — allow by default but log warning
  log.warn({ command: trimmed, subcommand }, 'Unknown git subcommand — allowing by default');
  return { allowed: true, command: trimmed };
}

/**
 * Check a command string for any git operations and validate them.
 * If a blocked git command is detected, throws an error.
 * Returns the sanitized command if allowed.
 */
export function validateAndSanitize(command: string): string {
  // Check for shell separators — if found, split into individual commands
  const hasSeparator = /(?:&&|\|\||;|\||\n)/.test(command.trim());
  if (hasSeparator) {
    const gitCommands = extractGitCommands(command);
    for (const gitCmd of gitCommands) {
      const result = checkGitCommand(gitCmd);
      if (!result.allowed) {
        throw new Error(`GitGuard blocked: ${result.reason} (in command: ${result.command})`);
      }
    }
    return command;
  }

  // Simple case: direct git command
  if (command.trim().toLowerCase().startsWith('git ')) {
    const result = checkGitCommand(command);
    if (!result.allowed) {
      throw new Error(`GitGuard blocked: ${result.reason} (command: ${result.command})`);
    }
    return command;
  }

  // Non-git command — always allowed
  return command;
}

/**
 * Extract individual git commands from a shell command string.
 * Handles: `cmd1 && cmd2`, `cmd1 ; cmd2`, `cmd1 || cmd2`, pipe chains.
 */
function extractGitCommands(command: string): string[] {
  const gitCommands: string[] = [];

  // Split by shell separators (&&, ||, ;, |, \n)
  const segments = command.split(/\s*(?:&&|\|\||;|\||\n)\s*/);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.toLowerCase().startsWith('git ')) {
      gitCommands.push(trimmed);
    }
  }

  return gitCommands;
}
