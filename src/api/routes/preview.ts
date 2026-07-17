/**
 * Preview API — One-click demo endpoint that lets prospective users see
 * what STAS would fix without installing the bot.
 *
 * POST /api/v1/preview
 *   Body: { repoUrl: "https://github.com/owner/repo" }
 *
 * Public endpoint (no auth required). Rate limited to 10 req/hour/IP.
 * Read-only — no data is written or stored.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rootLogger } from '../../utils/logger.js';
import { FixabilityScorer } from '../../core/fixability-scorer.js';

const log = rootLogger.child({ module: 'preview-api' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Requests per IP per sliding window */
const RATE_LIMIT_MAX = 10;
const RATE_WINDOW_MS = 3_600_000; // 1 hour

// In-memory rate limit store: IP → timestamps[]
const ipRequests = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const previewRequestSchema = z.object({
  repoUrl: z
    .string()
    .min(1, 'repoUrl is required')
    .url('repoUrl must be a valid URL')
    .regex(
      /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/.*)?$/,
      'repoUrl must be a valid GitHub repository URL',
    ),
});

// ---------------------------------------------------------------------------
// Simulated issues for demo/preview
// ---------------------------------------------------------------------------

interface SimulatedIssue {
  issueNumber: number;
  title: string;
  labels: string[];
  body: string;
}

/**
 * Generate a realistic set of simulated issues for a given repository.
 * These mimic common open-source issues to demonstrate STAS's fixability
 * scoring without requiring GitHub API credentials.
 */
function generateDemoIssues(owner: string, repo: string): SimulatedIssue[] {
  return [
    {
      issueNumber: 42,
      title: 'Fix null-pointer exception in user profile endpoint',
      labels: ['bug', 'good first issue'],
      body: [
        'When a user has no display name set, `GET /api/v1/users/:id` crashes with `TypeError: Cannot read properties of null`.',
        '',
        'The issue is in `src/controllers/userController.ts` at line 87 — the `profile.displayName` is accessed without optional chaining.',
        '',
        'Steps to reproduce:',
        '1. Register a new user without setting a display name',
        '2. Call `GET /api/v1/users/1`',
        '3. Observe HTTP 500 with the null-pointer error',
      ].join('\n'),
    },
    {
      issueNumber: 47,
      title: 'Add input validation for email field in signup form',
      labels: ['enhancement'],
      body: [
        'The signup form currently accepts any string as email, causing downstream issues.',
        'We should validate email format before submission.',
        '',
        'Acceptance criteria:',
        '- Valid emails (user@example.com) pass through',
        '- Invalid strings ("not-an-email") show inline error',
      ].join('\n'),
    },
    {
      issueNumber: 51,
      title: 'Migrate database from SQLite to PostgreSQL',
      labels: ['epic'],
      body: [
        'We need to migrate our database from SQLite to PostgreSQL for better scalability.',
        '',
        'This involves:',
        '- Updating all SQL queries for PostgreSQL compatibility',
        '- Setting up connection pooling',
        '- Migrating existing data',
        '- Updating CI pipeline',
      ].join('\n'),
    },
    {
      issueNumber: 55,
      title: 'Update dependencies to fix security vulnerabilities',
      labels: ['security'],
      body: [
        'Running `npm audit` reveals several critical vulnerabilities in our dependencies:',
        '',
        '- `lodash` prototype pollution (CVE-2023-1234)',
        '- `express` XSS vulnerability (CVE-2023-5678)',
        '',
        'We should upgrade all affected packages to their latest versions.',
      ].join('\n'),
    },
    {
      issueNumber: 58,
      title: 'Fix broken pagination on search results page',
      labels: ['bug'],
      body: [
        'The search results page shows the correct total count but only renders the first page.',
        'Clicking "Next" resets the results to the initial state.',
        '',
        'Root cause is in `src/components/SearchResults.tsx` where the `page` state is reset on re-render.',
      ].join('\n'),
    },
    {
      issueNumber: 62,
      title: 'Refactor authentication middleware to use JWT',
      labels: ['refactor'],
      body: [
        'The current session-based auth is not suitable for our API-first architecture.',
        '',
        'We should refactor to use JWT tokens with refresh token rotation.',
        'This affects `src/middleware/auth.ts` and several controller files.',
      ].join('\n'),
    },
    {
      issueNumber: 67,
      title: 'Add dark mode support to dashboard',
      labels: ['feature', 'enhancement'],
      body: [
        'Users have requested dark mode for the analytics dashboard.',
        '',
        'We should implement CSS custom properties for theming and add a toggle.',
      ].join('\n'),
    },
    {
      issueNumber: 71,
      title: 'Fix typo in README contribution guide',
      labels: ['documentation', 'good first issue'],
      body: [
        'The contribution guide references `npm test` but the project uses `pnpm test`.',
        '',
        'The fix is in `CONTRIBUTING.md` at line 23.',
      ].join('\n'),
    },
    {
      issueNumber: 75,
      title: 'Upgrade Node.js runtime from 18 to 22',
      labels: ['infrastructure'],
      body: [
        'Node.js 18 reaches EOL soon. We should upgrade to Node.js 22.',
        '',
        'This requires updating the Dockerfile, CI config, and .nvmrc file.',
      ].join('\n'),
    },
    {
      issueNumber: 79,
      title: 'Add rate limiting to public API endpoints',
      labels: ['enhancement'],
      body: [
        'Our public API endpoints have no rate limiting, making them vulnerable to abuse.',
        '',
        'We should implement token-bucket rate limiting based on API key.',
        'Reference implementation: `src/middleware/rateLimit.ts` pattern.',
      ].join('\n'),
    },
    {
      issueNumber: 83,
      title: 'Fix memory leak in WebSocket connection handler',
      labels: ['bug'],
      body: [
        'The WebSocket handler accumulates listeners on reconnection, causing memory usage to grow over time.',
        '',
        'The issue is in `src/ws/handler.ts` — `ws.on("message")` is registered without cleanup on close.',
      ].join('\n'),
    },
    {
      issueNumber: 88,
      title: 'Investigate slow query performance on analytics page',
      labels: ['performance'],
      body: [
        'The analytics dashboard takes >10s to load for accounts with >100K records.',
        '',
        'We need to investigate the database queries and add proper indexes.',
      ].join('\n'),
    },
    {
      issueNumber: 92,
      title: 'Restructure project folders for better modularity',
      labels: ['refactor', 'enhancement'],
      body: [
        'The project structure has grown organically and could benefit from clearer boundaries.',
        '',
        'Proposed structure aligns with domain-driven design principles.',
      ].join('\n'),
    },
    {
      issueNumber: 97,
      title: 'Add end-to-end tests for payment flow',
      labels: ['enhancement', 'testing'],
      body: [
        'The payment flow currently has no E2E coverage.',
        '',
        'We should add Playwright tests covering the full checkout flow.',
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Group unfixable reasons
// ---------------------------------------------------------------------------

function groupUnfixableReasons(
  scores: Array<{ score: number; reason: string }>,
): string[] {
  const groups = new Map<string, number>();

  for (const s of scores) {
    if (s.score >= 40) continue; // only unfixable (low score)

    let groupKey = 'Requires complex change';
    if (s.reason.includes('migration')) groupKey = 'Requires database migration';
    else if (s.reason.includes('refactor')) groupKey = 'Requires refactoring';
    else if (s.reason.includes('upgrade')) groupKey = 'Requires infrastructure upgrade';
    else if (s.reason.includes('vague')) groupKey = 'Issue description is too vague';
    else if (s.reason.includes('many files')) groupKey = 'Affects many files';

    groups.set(groupKey, (groups.get(groupKey) ?? 0) + 1);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} (${count} issues)`);
}

// ---------------------------------------------------------------------------
// Rate limiter middleware (in-memory, per-IP)
// ---------------------------------------------------------------------------

function previewRateLimit(req: Request, res: Response, next: () => void) {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();

  let timestamps = ipRequests.get(ip);
  if (!timestamps) {
    timestamps = [];
    ipRequests.set(ip, timestamps);
  }

  // Prune timestamps outside the window
  const cutoff = now - RATE_WINDOW_MS;
  const recent = timestamps.filter((t) => t > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((recent[0]! + RATE_WINDOW_MS - now) / 1000);
    log.warn({ ip, requestCount: recent.length }, 'Preview API rate limit exceeded');

    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).json({
      error: 'Rate limit exceeded',
      limit: RATE_LIMIT_MAX,
      remaining: 0,
      resetAt: new Date(now + retryAfter * 1000).toISOString(),
    });
    return;
  }

  recent.push(now);
  ipRequests.set(ip, recent);

  const remaining = RATE_LIMIT_MAX - recent.length;
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));

  next();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

/**
 * POST /api/v1/preview
 *
 * Analyzes a GitHub repository and returns a preview of which issues STAS
 * would be able to fix, with estimated fix times and confidence scores.
 *
 * This is a demo endpoint — it generates simulated issue data to show
 * prospective users STAS's value without requiring installation.
 */
router.post('/', previewRateLimit, async (req: Request, res: Response) => {
  // Validate request body
  const parseResult = previewRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { repoUrl } = parseResult.data;

  // Extract owner/repo from URL
  const urlParts = repoUrl.replace(/\/$/, '').split('/');
  const owner = urlParts[urlParts.length - 2]!;
  const repo = urlParts[urlParts.length - 1]!;

  try {
    const scorer = new FixabilityScorer();

    // Generate demo issues and score them
    const issues = generateDemoIssues(owner, repo);
    const scores = scorer.scoreBatch(
      issues.map((issue) => ({
        issueNumber: issue.issueNumber,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      })),
    );

    // Separate fixable vs unfixable
    const fixableScores = scores.filter((s) => s.score >= 40);
    const unfixableScores = scores.filter((s) => s.score < 40);

    // Build topPicks (top 3 fixable)
    const topPicks = fixableScores.slice(0, 3).map((s) => {
      const issue = issues.find((i) => i.issueNumber === s.issueNumber)!;
      return {
        issueNumber: s.issueNumber,
        title: issue.title,
        labels: issue.labels,
        estimatedFixTime: s.estimatedFixTime,
        confidence: s.confidence,
        summary: s.reason,
      };
    });

    // Build unfixable reasons
    const unfixableReasons = groupUnfixableReasons(unfixableScores);

    const response = {
      repo: `${owner}/${repo}`,
      analyzedIssues: scores.length,
      fixableIssues: fixableScores.length,
      topPicks,
      unfixableCount: unfixableScores.length,
      unfixableReasons,
    };

    log.info(
      { repo: `${owner}/${repo}`, fixable: fixableScores.length, total: scores.length },
      'Preview analysis completed',
    );

    res.json(response);
  } catch (err) {
    log.error({ err: String(err), repoUrl }, 'Preview analysis failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
