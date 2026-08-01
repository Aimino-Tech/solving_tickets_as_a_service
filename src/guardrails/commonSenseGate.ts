import type { Platform } from '../platforms/interface.js';
import type { IssueJobData } from '../utils/types.js';

export interface ValidationResult {
  valid: boolean;
  normalized?: { owner: string; repo: string };
  error?: string;
}

// ── Platform registry ────────────────────────────────────────────────────────

const PLATFORM_HOSTS: Record<Platform, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

/** All supported platforms as an array for iteration. */
export const SUPPORTED_PLATFORMS: Platform[] = ['github', 'gitlab', 'bitbucket'];

/** Check whether a string names a supported platform. */
export function isValidPlatform(platform: string): platform is Platform {
  return SUPPORTED_PLATFORMS.includes(platform as Platform);
}

// ── URL regex patterns per platform ─────────────────────────────────────────

/**
 * Regex patterns matching valid URL patterns for each platform.
 * Used for quick pre-filtering before full URL parsing.
 */
export const PLATFORM_URL_PATTERNS: Record<Platform, RegExp> = {
  github: /^https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/.*)?$/,
  gitlab: /^https?:\/\/(?:www\.)?gitlab\.com\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\/?$/,
  bitbucket: /^https?:\/\/(?:www\.)?bitbucket\.org\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/.*)?$/,
};

const MAX_ISSUE_NUMBER = 1_000_000;
const REPO_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export const HALLUCINATED_REPO_PATTERNS = [
  /^your-/i,
  /^example$/i,
  /^REPLACEME$/i,
  /^<[^>]+>$/,
  /^repo-name$/i,
  /^test-repo-\d+$/i,
];

// ── Destructive instruction patterns ─────────────────────────────────────────

/**
 * Narrow patterns that identify requests asking the agent to do something
 * destructive. Deliberately specific so legitimate issues are never rejected:
 * a bare mention of "workflows" or "package.json" does not match.
 */
export const DESTRUCTIVE_INSTRUCTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(?:delete|remove|drop)\s+(?:the\s+)?package\.json\b/i,
    reason: 'refusing to delete package.json',
  },
  {
    pattern: /(?:delete|remove|drop)\s+(?:the\s+)?(?:\.github[/\\]workflows?|workflows?\/)/i,
    reason: 'refusing to modify or delete CI workflow files',
  },
  {
    pattern: /force[- ]push(?:(?:\s+to\s+)?(?:the\s+)?main)?/i,
    reason: 'refusing to force push to the default branch',
  },
  {
    pattern: /(?:delete|destroy|remove)\s+(?:the\s+)?(?:entire\s+)?repository\b/i,
    reason: 'refusing to delete the repository',
  },
];

export function validatePlatformUrl(platform: Platform, url: string): ValidationResult {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, error: 'URL is empty or undefined' };
  }
  const host = PLATFORM_HOSTS[platform];
  if (!host) return { valid: false, error: `Unknown platform: ${platform}` };
  let normalized: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== host) {
      return {
        valid: false,
        error: `URL host "${parsed.hostname}" does not appear to be a ${platform} URL (expected "${host}")`,
      };
    }
    normalized = parsed.pathname.replace(/\.git$/, '').replace(/\/$/, '');
  } catch {
    return { valid: false, error: `Invalid URL: "${url}"` };
  }
  const segments = normalized.replace(/^\//, '').split('/');
  if (platform === 'gitlab') {
    if (segments.length < 2) return { valid: false, error: 'GitLab URL must include at least group/project' };
    const project = segments[segments.length - 1];
    const group = segments.slice(0, -1).join('/');
    if (!REPO_NAME_RE.test(project)) return { valid: false, error: `Invalid repo name "${project}" in URL` };
    return { valid: true, normalized: { owner: group, repo: project } };
  }
  if (segments.length < 2) return { valid: false, error: `URL must include owner/repo for ${platform}` };
  const [owner, repo] = segments;
  if (!owner || !repo) return { valid: false, error: `URL missing owner or repo for ${platform}` };
  if (!REPO_NAME_RE.test(repo)) return { valid: false, error: `Invalid repo name "${repo}" in URL` };
  return { valid: true, normalized: { owner, repo } };
}

export function validateIssueReference(issueNumber: number): ValidationResult {
  if (typeof issueNumber !== 'number' || Number.isNaN(issueNumber))
    return { valid: false, error: 'Issue number must be a number' };
  if (!Number.isInteger(issueNumber)) return { valid: false, error: 'Issue number must be an integer' };
  if (issueNumber <= 0) return { valid: false, error: 'Issue number must be greater than 0' };
  if (issueNumber > MAX_ISSUE_NUMBER)
    return { valid: false, error: `Issue number ${issueNumber} is suspiciously large (max: ${MAX_ISSUE_NUMBER})` };
  return { valid: true };
}

export function validateRepoName(name: string): ValidationResult {
  if (!name || typeof name !== 'string') return { valid: false, error: 'Repo name is empty or undefined' };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Repo name is empty' };
  if (trimmed.length > 100) return { valid: false, error: 'Repo name exceeds 100 characters' };
  if (!REPO_NAME_RE.test(trimmed))
    return { valid: false, error: `Repo name "${trimmed}" contains invalid characters or starts with a dot` };
  for (const pattern of HALLUCINATED_REPO_PATTERNS) {
    if (pattern.test(trimmed))
      return { valid: false, error: `Repo name "${trimmed}" appears to be a placeholder or hallucination` };
  }
  return { valid: true };
}

export interface CommonSenseInput {
  platform?: Platform;
  url?: string;
  issueNumber?: number;
  repoOwner?: string;
  repoName?: string;
  /** Free-text issue/request body scanned for destructive instructions. */
  body?: string;
}

export interface CommonSenseGateResult {
  passed: boolean;
  checks: Array<{ check: string; valid: boolean; error?: string }>;
}

/**
 * Thrown when a request fails the common-sense gate. Carries the check results
 * so callers can report exactly which check rejected the request.
 */
export class CommonSenseGateError extends Error {
  readonly checks: CommonSenseGateResult['checks'];

  constructor(result: CommonSenseGateResult) {
    const detail = result.checks
      .filter((c) => !c.valid)
      .map((c) => `${c.check}: ${c.error ?? 'invalid'}`)
      .join('; ');
    super(`Common-sense gate rejected issue — ${detail || 'no checks passed'}`);
    this.name = 'CommonSenseGateError';
    this.checks = result.checks;
  }
}

export function runCommonSenseGate(input: CommonSenseInput): CommonSenseGateResult {
  const checks: CommonSenseGateResult['checks'] = [];
  if (input.platform !== undefined && !isValidPlatform(input.platform)) {
    checks.push({ check: 'platform', valid: false, error: `Unsupported platform "${input.platform}"` });
  }
  const platform = input.platform ?? SUPPORTED_PLATFORMS[0];
  if (input.url) {
    const r = validatePlatformUrl(platform, input.url);
    checks.push({ check: 'platform_url', valid: r.valid, error: r.error });
  }
  if (input.issueNumber !== undefined) {
    const r = validateIssueReference(input.issueNumber);
    checks.push({ check: 'issue_number', valid: r.valid, error: r.error });
  }
  if (input.repoOwner) {
    const r = validateRepoName(input.repoOwner);
    checks.push({ check: 'repo_owner', valid: r.valid, error: r.error });
  }
  if (input.repoName) {
    const r = validateRepoName(input.repoName);
    checks.push({ check: 'repo_name', valid: r.valid, error: r.error });
  }
  if (input.body) {
    for (const { pattern, reason } of DESTRUCTIVE_INSTRUCTION_PATTERNS) {
      if (pattern.test(input.body)) {
        checks.push({ check: 'invariants', valid: false, error: reason });
        break;
      }
    }
  }
  return { passed: checks.every((c) => c.valid), checks };
}

/**
 * Run the common-sense gate against an IssueJobData payload. Sources that are
 * not a supported platform (slack, telegram, mcp, ...) are not platform-checked
 * rather than rejected; the repo/issue/invariants checks still apply.
 */
export function guardIssueJobData(data: IssueJobData): CommonSenseGateResult {
  const source = data.source;
  const platform = source !== undefined && isValidPlatform(source) ? source : undefined;
  return runCommonSenseGate({
    platform,
    issueNumber: data.issueNumber,
    repoOwner: data.repoOwner,
    repoName: data.repoName,
    body: data.issueBody ?? undefined,
  });
}
