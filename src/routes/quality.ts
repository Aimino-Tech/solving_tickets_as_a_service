/**
 * Quality gate and compliance API routes.
 *
 * Endpoints:
 *   POST /api/quality/gates/run       — Trigger quality gates
 *   GET  /api/quality/gates/status/:id — Check gate run status
 *   GET  /api/quality/compliance      — Compliance report
 *   GET  /api/quality/score-card      — Compute quality score card (existing)
 *   POST /api/quality/score-card      — Store quality score card (existing)
 *   GET  /api/quality/score-card/:id  — Fetch stored score card (existing)
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { runAllGates, runQuickGates } from '../pipeline/quality-gates.js';
import { runComplianceChecks } from '../pipeline/compliance.js';

const log = rootLogger.child({ module: 'quality-api' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface GateRunRecord {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  report?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const gateRuns = new Map<string, GateRunRecord>();

// ---------------------------------------------------------------------------
// Existing score card types and store
// ---------------------------------------------------------------------------

interface StoredScoreCard {
  id: string;
  runId: string;
  overall: number;
  dimensions: {
    test_pass_rate: { score: number; raw: Record<string, unknown>; details: string };
    ac_coverage: { score: number; raw: Record<string, unknown>; details: string };
    code_style: { score: number; raw: Record<string, unknown>; details: string };
  };
  weights: Record<string, number>;
  createdAt: string;
}

const scoreCards = new Map<string, StoredScoreCard>();

// ---------------------------------------------------------------------------
// POST /gates/run — Trigger quality gates
// ---------------------------------------------------------------------------

router.post('/gates/run', async (req: Request, res: Response) => {
  try {
    const { repoDir, runLint, runSecurity, quick } = req.body as {
      repoDir?: string;
      runLint?: boolean;
      runSecurity?: boolean;
      quick?: boolean;
    };

    const runId = crypto.randomUUID();
    const record: GateRunRecord = {
      id: runId,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    gateRuns.set(runId, record);

    // Respond immediately with the run ID, then execute asynchronously
    res.status(202).json({
      id: runId,
      status: 'running',
      message: 'Quality gate run started',
    });

    // Run gates asynchronously
    try {
      // Create an execFn that uses the sandbox if available, or falls back to local exec
      const execFn = async (
        cmd: string,
        timeout?: number,
      ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
        const { execSync } = await import('node:child_process');
        try {
          const result = execSync(cmd, {
            cwd: repoDir || process.cwd(),
            timeout: timeout ?? 300_000,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          } as import('node:child_process').ExecSyncOptions);
          return { stdout: result?.toString() || '', stderr: '', exitCode: 0 };
        } catch (err: unknown) {
          const execError = err as {
            stdout?: string | Buffer;
            stderr?: string | Buffer;
            status?: number;
            message?: string;
          };
          return {
            stdout: execError.stdout?.toString() || '',
            stderr: execError.stderr?.toString() || execError.message || String(err),
            exitCode: execError.status ?? 1,
          };
        }
      };

      let report;
      if (quick) {
        report = await runQuickGates(execFn);
      } else {
        report = await runAllGates({
          sandbox: null, // No sandbox for API-triggered runs (uses local exec)
          diff: '',
          execFn,
          config: {
            skipLint: !runLint,
            skipSecurity: !runSecurity,
          },
        });
      }

      record.status = 'completed';
      record.report = report;
      record.completedAt = new Date().toISOString();

      log.info(
        { runId, passed: report.passed, gates: report.gates.length },
        'Quality gate run completed',
      );
    } catch (err) {
      record.status = 'failed';
      record.error = String(err);
      record.completedAt = new Date().toISOString();
      log.error({ err: String(err), runId }, 'Quality gate run failed');
    }
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to trigger quality gates');
    res.status(500).json({ error: 'Failed to trigger quality gates' });
  }
});

// ---------------------------------------------------------------------------
// GET /gates/status/:id — Check gate run status
// ---------------------------------------------------------------------------

router.get('/gates/status/:id', (req: Request, res: Response) => {
  try {
    const record = gateRuns.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Gate run not found' });
      return;
    }

    res.json({
      id: record.id,
      status: record.status,
      report: record.report,
      error: record.error,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to get gate run status');
    res.status(500).json({ error: 'Failed to get gate run status' });
  }
});

// ---------------------------------------------------------------------------
// GET /compliance — Compliance report
// ---------------------------------------------------------------------------

router.get('/compliance', async (req: Request, res: Response) => {
  try {
    const repoDir = req.query.repoDir as string | undefined;

    const execFn = async (
      cmd: string,
      timeout?: number,
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      const { execSync } = await import('node:child_process');
      try {
        const result = execSync(cmd, {
          cwd: repoDir || process.cwd(),
          timeout: timeout ?? 300_000,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        } as import('node:child_process').ExecSyncOptions);
        return { stdout: result?.toString() || '', stderr: '', exitCode: 0 };
      } catch (err: unknown) {
        const execError = err as {
          stdout?: string | Buffer;
          stderr?: string | Buffer;
          status?: number;
          message?: string;
        };
        return {
          stdout: execError.stdout?.toString() || '',
          stderr: execError.stderr?.toString() || execError.message || String(err),
          exitCode: execError.status ?? 1,
        };
      }
    };

    const report = await runComplianceChecks({ execFn });

    res.json({
      passed: report.passed,
      summary: report.summary,
      checks: report.checks.map((c) => ({
        check: c.check,
        passed: c.passed,
        durationMs: c.durationMs,
        details: c.details,
        findings: c.findings,
      })),
      findings: report.findings,
      totalDurationMs: report.totalDurationMs,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to generate compliance report');
    res.status(500).json({ error: 'Failed to generate compliance report' });
  }
});

// ---------------------------------------------------------------------------
// GET /score-card — Compute quality score card (existing)
// ---------------------------------------------------------------------------

router.get('/score-card', (req: Request, res: Response) => {
  try {
    const {
      passed,
      total,
      acText,
      testOutput,
      lintErrors,
      lintWarnings,
      formatIssues,
      totalFiles,
    } = req.query;

    if (total === undefined || total === '') {
      res.status(400).json({ error: 'Missing required query parameter: total' });
      return;
    }

    const passedNum = Number(passed ?? 0);
    const totalNum = Number(total);

    const testRateScore = computeTestPassRate(passedNum, totalNum);
    let acScore: number;
    let acRaw: Record<string, unknown>;
    if (acText && typeof acText === 'string') {
      const result = computeACCoverage(acText, typeof testOutput === 'string' ? testOutput : '');
      acScore = result.score;
      acRaw = result.raw;
    } else {
      acScore = 0;
      acRaw = { ac_count: 0, covered: 0, ratio: 0 };
    }

    const styleScore = computeCodeStyle(
      Number(lintErrors ?? 0),
      Number(lintWarnings ?? 0),
      Number(formatIssues ?? 0),
      Number(totalFiles ?? 1),
    );

    const weights = { test_pass_rate: 0.4, ac_coverage: 0.35, code_style: 0.25 };
    const overall =
      testRateScore.score * weights.test_pass_rate +
      acScore * weights.ac_coverage +
      styleScore.score * weights.code_style;

    res.json({
      overall: Math.round(Math.min(overall, 1.0) * 10_000) / 10_000,
      weights,
      dimensions: {
        test_pass_rate: {
          score: testRateScore.score,
          raw: testRateScore.raw,
          details: testRateScore.details,
        },
        ac_coverage: {
          score: acScore,
          raw: acRaw,
          details: acScore > 0
            ? `${String(acRaw.covered)}/${String(acRaw.ac_count)} AC statements covered`
            : 'No acceptance criteria provided',
        },
        code_style: {
          score: styleScore.score,
          raw: styleScore.raw,
          details: styleScore.details,
        },
      },
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to compute quality score card');
    res.status(500).json({ error: 'Failed to compute quality score card' });
  }
});

// ---------------------------------------------------------------------------
// POST /score-card — Store quality score card (existing)
// ---------------------------------------------------------------------------

router.post('/score-card', (req: Request, res: Response) => {
  try {
    const { runId, overall, dimensions, weights } = req.body;

    if (!runId || overall === undefined || !dimensions) {
      res.status(400).json({ error: 'Missing required fields: runId, overall, dimensions' });
      return;
    }

    const id = crypto.randomUUID();
    const entry: StoredScoreCard = {
      id,
      runId,
      overall,
      dimensions,
      weights: weights ?? { test_pass_rate: 0.4, ac_coverage: 0.35, code_style: 0.25 },
      createdAt: new Date().toISOString(),
    };

    scoreCards.set(id, entry);
    log.info({ id, runId, overall }, 'Stored quality score card');

    res.status(201).json(entry);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to store quality score card');
    res.status(500).json({ error: 'Failed to store quality score card' });
  }
});

// ---------------------------------------------------------------------------
// GET /score-card/:id — Fetch stored score card (existing)
// ---------------------------------------------------------------------------

router.get('/score-card/:id', (req: Request, res: Response) => {
  try {
    const entry = scoreCards.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Score card not found' });
      return;
    }
    res.json(entry);
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to fetch score card');
    res.status(500).json({ error: 'Failed to fetch score card' });
  }
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function computeTestPassRate(
  passed: number,
  total: number,
): { score: number; raw: Record<string, unknown>; details: string } {
  if (total <= 0) {
    return { score: 0, raw: { passed: 0, total: 0 }, details: 'No tests were executed.' };
  }

  const rate = passed / total;
  let final: number;

  if (rate >= 0.95) {
    final = 1.0;
  } else if (rate >= 0.8) {
    final = 0.5 + 0.5 * ((rate - 0.8) / 0.15);
  } else if (rate >= 0.5) {
    final = 0.25 + 0.25 * ((rate - 0.5) / 0.3);
  } else {
    final = Math.max(rate * 0.5, 0.0);
  }

  return {
    score: Math.round(final * 10_000) / 10_000,
    raw: { passed, total, failed: total - passed, rate: Math.round(rate * 10_000) / 10_000 },
    details: `${passed}/${total} tests passed (${(rate * 100).toFixed(1)}%)`,
  };
}

function computeACCoverage(
  acceptanceCriteria: string,
  testOutput: string,
): { score: number; raw: Record<string, unknown> } {
  const acLines = acceptanceCriteria
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.startsWith('-') || l.startsWith('*') || /^\d+[.)]/.test(l));

  if (acLines.length === 0) {
    return { score: 0, raw: { ac_count: 0, covered: 0, ratio: 0 } };
  }

  const testNames = new Set<string>();
  const testRe = /(\S+\.py::\w+(?:::\w+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = testRe.exec(testOutput)) !== null) {
    testNames.add(m[1]);
  }
  const testRe2 = /--- (?:PASS|FAIL): (Test\w+)/g;
  while ((m = testRe2.exec(testOutput)) !== null) {
    testNames.add(m[2]);
  }

  let covered = 0;
  for (const ac of acLines) {
    const keywords = new Set(
      (ac.toLowerCase().match(/\b([a-zA-Z]\w{3,})\b/g) ?? [])
        .filter((kw) => kw.length > 3),
    );

    let bestOverlap = 0;
    for (const tn of testNames) {
      const tnLower = tn.toLowerCase();
      let overlap = 0;
      for (const kw of keywords) {
        if (tnLower.includes(kw)) overlap++;
      }
      if (overlap > bestOverlap) bestOverlap = overlap;
      if (bestOverlap >= keywords.size) break;
    }

    if (keywords.size > 0 && bestOverlap >= Math.max(keywords.size * 0.4, 1)) {
      covered++;
    }
  }

  const ratio = acLines.length > 0 ? covered / acLines.length : 0;
  return {
    score: Math.round(ratio * 10_000) / 10_000,
    raw: { ac_count: acLines.length, covered, ratio: Math.round(ratio * 10_000) / 10_000 },
  };
}

function computeCodeStyle(
  lintErrors: number,
  lintWarnings: number,
  formatIssues: number,
  totalFiles: number,
): { score: number; raw: Record<string, unknown>; details: string } {
  const files = Math.max(totalFiles, 1);
  const errorPenalty = Math.min(lintErrors / files, 1.0) * 0.6;
  const warningPenalty = Math.min(lintWarnings / (files * 3), 1.0) * 0.25;
  const formatPenalty = Math.min(formatIssues / (files * 2), 1.0) * 0.15;

  const score = Math.max(1.0 - errorPenalty - warningPenalty - formatPenalty, 0.0);

  const parts: string[] = [];
  if (lintErrors > 0) parts.push(`${lintErrors} error(s)`);
  if (lintWarnings > 0) parts.push(`${lintWarnings} warning(s)`);
  if (formatIssues > 0) parts.push(`${formatIssues} format issue(s)`);
  if (parts.length === 0) parts.push('No issues found');

  return {
    score: Math.round(score * 10_000) / 10_000,
    raw: { lint_errors: lintErrors, lint_warnings: lintWarnings, format_issues: formatIssues, total_files: files },
    details: `${parts.join(', ')} across ${files} file(s) — score ${score.toFixed(2)}`,
  };
}

export { router as qualityRouter };
