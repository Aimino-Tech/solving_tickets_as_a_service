import type { Platform } from '../platforms/interface.js';

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
  platform: Platform;
  url?: string;
  issueNumber?: number;
  repoOwner?: string;
  repoName?: string;
  title?: string;
  body?: string | null;
}

export interface CommonSenseGateResult {
  passed: boolean;
  checks: Array<{ check: string; valid: boolean; error?: string }>;
}

// ── Issue-content sanity / invariant checks (AIM-4496) ─────────────────

/**
 * Files that must never be deleted or replaced by a fix. Removing the
 * manifest or a lockfile breaks dependency resolution for the whole repo.
 */
const PROTECTED_MANIFEST_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.json',
  'Cargo.toml',
  'go.mod',
];

/**
 * Paths that the bot must never modify. CI/CD workflow definitions are
 * operational configuration and out of scope for issue fixes.
 */
const PROTECTED_WORKFLOW_PATHS = ['.github/workflows/', 'workflows/', '.gitlab-ci.yml', '.circleci/config.yml'];

/** Regex matching an explicit request to delete a protected manifest file. */
const DELETE_MANIFEST_RE =
  /(?:delete|remove|rm\b|drop|erase|wipe)\s+(?:the\s+)?(?:file\s+)?(?:`)?(?:\.\/)?(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.json|Cargo\.toml|go\.mod)/i;

const PROTECTED_WORKFLOW_FILES_RE = PROTECTED_WORKFLOW_PATHS.map((p) =>
  p.replace(/\./g, '\\.').replace(/\//g, '\\/'),
).join('|');

/** Regex matching an explicit request to modify a protected workflow path. */
const MODIFY_WORKFLOWS_RE = new RegExp(
  `(?:modify|edit|change|update|rewrite|delete|remove|rm\\b|add|create|recreate)\\s+(?:the\\s+)?(?:\\\`)?(?:\\\\.\\\\/)?(?:${PROTECTED_WORKFLOW_FILES_RE})`,
  'i',
);

/**
 * Content sanity check: reject issues that explicitly instruct the bot to
 * delete a protected manifest/lockfile or to modify workflow definitions.
 * These are invariant violations that must never reach the agent pipeline.
 */
export function validateIssueContent(title: string | undefined, body: string | null | undefined): ValidationResult {
  const text = [title, body].filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n');
  if (!text) return { valid: true };

  const lower = text.toLowerCase();
  if (DELETE_MANIFEST_RE.test(lower)) {
    const matched = PROTECTED_MANIFEST_FILES.find((f) => lower.includes(f.toLowerCase()));
    return {
      valid: false,
      error: `Issue requests deletion of a protected manifest/lockfile${matched ? ` (${matched})` : ''} — refusing`,
    };
  }
  if (MODIFY_WORKFLOWS_RE.test(lower)) {
    return {
      valid: false,
      error: 'Issue requests modifying workflow definitions — off-limits for STAS fixes',
    };
  }

  // Path traversal / absolute-path mutations are always suspicious.
  if (/(?:delete|remove|rm\b)\s+\.\.\/|(?:delete|remove|rm\b)\s+\//.test(lower)) {
    return { valid: false, error: 'Issue references deleting paths outside the repo (../ or /) — refusing' };
  }

  return { valid: true };
}

/**
 * Cost-benefit gate: reject issues that would burn agent budget on work
 * that is unactionable, unbounded, or destructive. This is a lightweight
 * heuristic applied BEFORE the (expensive) agent pipeline.
 */
export function validateCostBenefit(title: string | undefined, body: string | null | undefined): ValidationResult {
  const text = [title, body]
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join(' ')
    .trim();
  if (!text) {
    return { valid: false, error: 'Issue has no actionable content (empty title and body)' };
  }
  if (text.length < 10) {
    return { valid: false, error: 'Issue is too short to contain an actionable fix request' };
  }

  const lower = text.toLowerCase();
  // Unbounded / impossible requests are never worth the agent cost.
  const unbounded =
    /(?:fix|solve|resolve)\s+(?:everything|all (?:the )?bugs|all tests|the entire (?:codebase|project|repo|system))/i.test(
      lower,
    ) ||
    /(?:rewrite|rearchitect|rebuild|refactor)\s+(?:the )?(?:entire|whole)\s+(?:codebase|project|repo|system)/i.test(
      lower,
    );
  if (unbounded) {
    return { valid: false, error: 'Request is unbounded in scope — expected cost exceeds likely benefit' };
  }

  return { valid: true };
}

export function runCommonSenseGate(input: CommonSenseInput): CommonSenseGateResult {
  const checks: CommonSenseGateResult['checks'] = [];
  if (input.url) {
    const r = validatePlatformUrl(input.platform, input.url);
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
  if (input.title !== undefined || input.body !== undefined) {
    const content = validateIssueContent(input.title, input.body);
    checks.push({ check: 'issue_content', valid: content.valid, error: content.error });
    const costBenefit = validateCostBenefit(input.title, input.body);
    checks.push({ check: 'cost_benefit', valid: costBenefit.valid, error: costBenefit.error });
  }
  return { passed: checks.every((c) => c.valid), checks };
}
