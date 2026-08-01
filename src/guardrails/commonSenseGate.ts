import type { Platform } from '../platforms/interface.js';
import type { IssueJobData } from '../utils/types.js';

export interface ValidationResult {
  valid: boolean;
  normalized?: { owner: string; repo: string };
  error?: string;
}

// ── Hard file guardrails (AIM-4496) ────────────────────────────────────────
// Paths that an agent may never delete or modify. Changes touching these are
// rejected before the pipeline is allowed to create a PR.

/** Files that must never be deleted or renamed by an automated fix. */
export const PROTECTED_MANIFEST_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'mix.lock',
  'pubspec.lock',
  'poetry.lock',
];

/**
 * Directory prefixes that are off-limits for automated fixes.
 * `workflows/` is a hard guardrail — CI/CD definitions must never be changed
 * by the agent (AIM-4496). Other entries cover security-sensitive paths.
 */
export const PROTECTED_DIR_PREFIXES = [
  'workflows/',
  '.github/workflows/',
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  'Jenkinsfile',
  'Dockerfile',
  'docker-compose.yml',
  '.env',
  'secrets/',
];

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
}

/**
 * Validate a set of proposed file changes against the hard guardrails.
 * Rejects deletion of package manifests and any change under protected
 * paths (never modify `workflows/`, `.github/workflows/`, CI definitions).
 */
export function validateFileChanges(changes: FileChange[]): CommonSenseGateResult {
  const checks: CommonSenseGateResult['checks'] = [];
  if (!changes || changes.length === 0) {
    checks.push({ check: 'file_changes', valid: true });
    return { passed: true, checks };
  }

  for (const change of changes) {
    const path = change.path || '';

    if (change.status === 'removed' && PROTECTED_MANIFEST_FILES.includes(path)) {
      checks.push({
        check: 'manifest_deletion',
        valid: false,
        error: `Deleting "${path}" is not allowed — it defines the project's dependency graph`,
      });
    }

    const matchesProtected = PROTECTED_DIR_PREFIXES.some(
      (p) => path === p || path.startsWith(p) || path.endsWith(`/${p}`) || path === p.replace(/\/$/, ''),
    );
    if (matchesProtected) {
      checks.push({
        check: 'protected_path',
        valid: false,
        error: `Modifying "${path}" is not allowed — protected by Common Sense Gate hard guardrail`,
      });
    }

    if (path.startsWith('/') || path.includes('../') || path.includes('..\\')) {
      checks.push({
        check: 'path_traversal',
        valid: false,
        error: `Path "${path}" is outside the repository root`,
      });
    }
  }

  const failed = checks.filter((c) => !c.valid);
  return {
    passed: failed.length === 0,
    checks,
  };
}

// ── Cost-benefit analysis (AIM-4496) ───────────────────────────────────────

export interface CostBenefitEstimate {
  estimatedCostCents: number;
  estimatedValueCents: number;
  roi: number;
  recommended: boolean;
  reasons: string[];
}

/**
 * Deterministic cost-benefit estimate for a proposed fix run.
 * Heuristics only — used to decide whether dispatching an issue is worth the
 * agent cost, and to surface obviously wasteful runs (e.g. a "fix" for an
 * empty body, or a repo name that is clearly a placeholder).
 */
export function analyzeCostBenefit(
  input: CommonSenseInput & {
    issueTitle?: string | null;
    issueBody?: string | null;
    labels?: string[];
  },
): CostBenefitEstimate {
  const reasons: string[] = [];

  const title = input.issueTitle?.trim() ?? '';
  const body = input.issueBody?.trim() ?? '';
  const text = `${title}\n${body}`.toLowerCase();

  let estimatedCostCents = 50;
  const hasFrontierLabels = (input.labels ?? []).some(
    (l) => /feature|enhancement|performance|security|refactor|research/i.test(l),
  );
  if (hasFrontierLabels) estimatedCostCents = 120;
  if (text.length > 4000) estimatedCostCents = 150;

  let estimatedValueCents = 0;
  const severitySignals = [
    /bug|crash|broken|error|fail|exception|panic|corrupt|regression/i,
    /security|vulnerab|injection|xss|csrf|auth|leak|expos/i,
    /performance|slow|latency|memory leak|timeout|hang/i,
    /data loss|corrupt|delete|missing|unreachable/i,
  ];
  for (const pattern of severitySignals) {
    if (pattern.test(text)) estimatedValueCents += 100;
  }

  if (hasFrontierLabels) estimatedValueCents += 50;
  if (title.length >= 15) estimatedValueCents += 30;
  if (body.length >= 120) estimatedValueCents += 40;
  if (estimatedValueCents === 0) {
    reasons.push('No clear severity or scope signals in issue text');
  }

  const roi = estimatedCostCents > 0 ? (estimatedValueCents - estimatedCostCents) / estimatedCostCents : 0;
  const recommended = estimatedValueCents >= estimatedCostCents;

  if (recommended) {
    reasons.push(`Expected value (${estimatedValueCents}c) covers estimated cost (${estimatedCostCents}c)`);
  } else {
    reasons.push(`Estimated cost (${estimatedCostCents}c) exceeds expected value (${estimatedValueCents}c)`);
  }

  return { estimatedCostCents, estimatedValueCents, roi: Math.round(roi * 100) / 100, recommended, reasons };
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

export function validatePlatformUrl(
  platform: Platform,
  url: string,
): ValidationResult {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, error: 'URL is empty or undefined' };
  }
  const host = PLATFORM_HOSTS[platform];
  if (!host) return { valid: false, error: `Unknown platform: ${platform}` };
  let normalized: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== host) {
      return { valid: false, error: `URL host "${parsed.hostname}" does not appear to be a ${platform} URL (expected "${host}")` };
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
  if (typeof issueNumber !== 'number' || Number.isNaN(issueNumber)) return { valid: false, error: 'Issue number must be a number' };
  if (!Number.isInteger(issueNumber)) return { valid: false, error: 'Issue number must be an integer' };
  if (issueNumber <= 0) return { valid: false, error: 'Issue number must be greater than 0' };
  if (issueNumber > MAX_ISSUE_NUMBER) return { valid: false, error: `Issue number ${issueNumber} is suspiciously large (max: ${MAX_ISSUE_NUMBER})` };
  return { valid: true };
}

export function validateRepoName(name: string): ValidationResult {
  if (!name || typeof name !== 'string') return { valid: false, error: 'Repo name is empty or undefined' };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Repo name is empty' };
  if (trimmed.length > 100) return { valid: false, error: 'Repo name exceeds 100 characters' };
  if (!REPO_NAME_RE.test(trimmed)) return { valid: false, error: `Repo name "${trimmed}" contains invalid characters or starts with a dot` };
  for (const pattern of HALLUCINATED_REPO_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, error: `Repo name "${trimmed}" appears to be a placeholder or hallucination` };
  }
  return { valid: true };
}

export interface CommonSenseInput {
  platform: Platform;
  url?: string;
  issueNumber?: number;
  repoOwner?: string;
  repoName?: string;
}

export interface CommonSenseGateResult {
  passed: boolean;
  checks: Array<{ check: string; valid: boolean; error?: string }>;
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
  return { passed: checks.every((c) => c.valid), checks };
}

/**
 * Common Sense Gate for a normalised webhook job: input validators + hard file
 * guardrails, evaluated before the job reaches the agent pipeline.
 */
export function runCommonSenseGateOnJob(
  job: IssueJobData,
  options?: {
    fileChanges?: FileChange[];
    source?: Platform;
    url?: string;
  },
): CommonSenseGateResult {
  const source = options?.source ?? (job.source as Platform | undefined);
  const url = options?.url;

  const input: CommonSenseInput = {
    platform: source ?? 'github',
    url,
    issueNumber: job.issueNumber > 0 ? job.issueNumber : undefined,
    repoOwner: job.repoOwner,
    repoName: job.repoName,
  };

  const base = runCommonSenseGate(input);
  const checks = [...base.checks];

  if (options?.fileChanges && options.fileChanges.length > 0) {
    const fileResult = validateFileChanges(options.fileChanges);
    checks.push(...fileResult.checks);
  }

  return { passed: checks.every((c) => c.valid), checks };
}
