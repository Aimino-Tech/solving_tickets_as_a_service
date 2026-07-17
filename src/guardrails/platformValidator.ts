import type { Platform } from '../platforms/interface.js';
import { HALLUCINATED_REPO_PATTERNS } from './commonSenseGate.js';
import type { ValidationResult } from './commonSenseGate.js';

const BRANCH_DISALLOWED_RE = /(\.\.|@\{|\s|~|\^|:|\\(?![0-9])|\[|\?|\*)/;
const BRANCH_CONTROL_RE = /[\x00-\x1F\x7F]/;
const BRANCH_LOCK_SUFFIX = '.lock';
const REFS_PREFIX = 'refs/';

const WEBHOOK_PATHS: Record<Platform, string> = {
  github: '/webhooks/github',
  gitlab: '/webhooks/gitlab',
  bitbucket: '/webhooks/bitbucket',
};

export function validateRepoIdentifier(identifier: string): ValidationResult {
  if (!identifier || typeof identifier !== 'string') return { valid: false, error: 'Repo identifier is empty or undefined' };
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Repo identifier is empty' };
  const slashCount = (trimmed.match(/\//g) ?? []).length;
  if (slashCount === 0) return { valid: false, error: 'Repo identifier must be in owner/repo format (missing slash)' };
  if (slashCount > 1) return { valid: false, error: 'Repo identifier must be in owner/repo format (too many slashes)' };
  const [owner, repo] = trimmed.split('/');
  if (!owner || owner.length === 0) return { valid: false, error: 'Repo owner is empty' };
  if (!repo || repo.length === 0) return { valid: false, error: 'Repo name is empty' };
  const segmentRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (!segmentRe.test(owner)) return { valid: false, error: `Repo owner "${owner}" contains invalid characters` };
  if (!segmentRe.test(repo)) return { valid: false, error: `Repo name "${repo}" contains invalid characters` };
  for (const pattern of HALLUCINATED_REPO_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, error: `Repo identifier "${trimmed}" appears to be a placeholder or hallucination` };
  }
  return { valid: true };
}

export function validateBranchName(platform: Platform, branchName: string): ValidationResult {
  if (!branchName || typeof branchName !== 'string') return { valid: false, error: 'Branch name is empty or undefined' };
  const trimmed = branchName.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Branch name is empty' };
  if (trimmed.length > 255) return { valid: false, error: 'Branch name exceeds 255 characters' };
  if (trimmed.startsWith('.')) return { valid: false, error: 'Branch name cannot start with a dot' };
  if (trimmed.startsWith('-')) return { valid: false, error: 'Branch name cannot start with a hyphen' };
  if (trimmed.startsWith(REFS_PREFIX)) return { valid: false, error: 'Branch name cannot start with refs/' };
  if (trimmed.endsWith(BRANCH_LOCK_SUFFIX)) return { valid: false, error: 'Branch name cannot end with .lock' };
  if (BRANCH_DISALLOWED_RE.test(trimmed)) return { valid: false, error: 'Branch name contains disallowed characters (.., @{, space, ~, ^, :, \\, [, ?, *)' };
  if (BRANCH_CONTROL_RE.test(trimmed)) return { valid: false, error: 'Branch name contains control characters' };
  return { valid: true };
}

export function validateWebhookUrl(platform: Platform, urlPath: string): ValidationResult {
  if (!urlPath || typeof urlPath !== 'string') return { valid: false, error: 'Webhook URL path is empty or undefined' };
  const trimmed = urlPath.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Webhook URL path is empty' };
  const expected = WEBHOOK_PATHS[platform];
  if (!expected) return { valid: false, error: `Unknown platform: ${platform}` };
  if (trimmed !== expected) return { valid: false, error: `Expected path "${expected}" for ${platform} webhook, got "${trimmed}"` };
  return { valid: true };
}
