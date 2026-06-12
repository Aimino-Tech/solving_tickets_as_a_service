/**
 * RapidAPI router — mounts all API routes with auth and rate limiting.
 *
 * Route structure:
 *   POST /api/fix            — Submit a fix job (auth + rate limited)
 *   GET  /api/fix/:jobId     — Poll job status (auth + rate limited)
 *   GET  /api/eval/results   — Aggregate eval results (public)
 *   GET  /api/eval/latest    — Latest eval run (public)
 *   GET  /api/health         — Health check (public)
 */

import { Router, type Request, type Response } from 'express';
import { rapidApiAuth } from './middleware/rapidApiAuth.js';
import { rateLimit } from './middleware/rateLimit.js';
import fixRoutes from './fixRoutes.js';
import evalRoutes from './evalRoutes.js';

const router = Router();

// ── Health check (public, no auth required) ─────────────────────────────
router.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'STAS RapidAPI',
    timestamp: new Date().toISOString(),
  });
});

// ── Eval endpoints (public, no auth required) ──────────────────────────
// These show benchmark results so potential customers can evaluate STAS
// before subscribing.
router.use('/api/eval', evalRoutes);

// ── Fix endpoints (auth + rate limited) ────────────────────────────────
router.use('/api/fix', rapidApiAuth, rateLimit, fixRoutes);

export default router;
