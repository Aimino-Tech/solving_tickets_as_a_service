/**
 * Evaluation API routes — Lighthouse-based quality evaluation for the dashboard.
 *
 * Endpoints:
 *   GET  /api/v1/evaluation/lighthouse      — Latest evaluation + feedback deltas
 *   POST /api/v1/evaluation/lighthouse/run  — Trigger a sweep (async, 202)
 *
 * The evaluation follows the 4-pillar model (criteria / evidence / rubrics /
 * feedback loop) implemented in src/evaluation/lighthouseRunner.ts.
 */

import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getLighthouseEvaluation, runLighthouseSweep } from '../evaluation/lighthouseRunner.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'evaluation-api' });

const router: Router = Router();

const RUN_COOLDOWN_MS = 60_000;

let inFlightRun: { id: string; startedAt: number } | null = null;

// ---------------------------------------------------------------------------
// GET /lighthouse — latest evaluation snapshot + feedback loop deltas
// ---------------------------------------------------------------------------

router.get('/lighthouse', requireAuth, (_req: Request, res: Response) => {
  res.json(getLighthouseEvaluation());
});

// ---------------------------------------------------------------------------
// POST /lighthouse/run — trigger a sweep, respond immediately (202)
// ---------------------------------------------------------------------------

router.post('/lighthouse/run', requireAuth, (_req: Request, res: Response) => {
  const now = Date.now();
  if (inFlightRun) {
    res.status(409).json({ error: 'A Lighthouse sweep is already running', id: inFlightRun.id });
    return;
  }

  const lastRunAt = getLighthouseEvaluation().lastRunAt;
  if (lastRunAt && now - Date.parse(lastRunAt) < RUN_COOLDOWN_MS) {
    res.status(429).json({ error: 'Lighthouse sweep was run recently — try again shortly' });
    return;
  }

  const runId = randomUUID();
  inFlightRun = { id: runId, startedAt: now };
  res.status(202).json({ id: runId, status: 'running', message: 'Lighthouse sweep started' });

  void runLighthouseSweep()
    .then((result) => {
      log.info(
        { runId, ok: result.ok, score: result.evaluation?.score ?? null, message: result.message },
        'Lighthouse sweep completed',
      );
    })
    .catch((err) => {
      log.error({ runId, err: String(err) }, 'Lighthouse sweep failed');
    })
    .finally(() => {
      inFlightRun = null;
    });
});

export const evaluationRouter: Router = router;
