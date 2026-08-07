/**
 * Referral program REST API routes (AIM-4643).
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 *   GET  /api/v1/referral/code              — Caller's referral code (generates on first call)
 *   POST /api/v1/referral/code              — Explicitly ensure/generate the caller's code
 *   POST /api/v1/referral/redeem            — Validate code + email at signup, create pending rewards
 *   POST /api/v1/referral/click             — Count a click on a referral code (public, rate-limited)
 *   GET  /api/v1/referral/stats             — Caller's referral stats (clicks, invites, fixes)
 *   GET  /api/v1/referral/rewards           — List the caller's rewards
 *   POST /api/v1/referral/rewards/:id/claim — Grant 10 fixes (account allowance) and mark claimed
 * ────────────────────────────────────────────────────────────────────────────
 *
 * /code, /stats and /rewards* require a valid JWT (requireAuth). /redeem and
 * /click are public — /redeem is invoked at signup time by the auth register
 * flow (rate-limited to 10/min/IP), /click tracks anonymous referral-link
 * clicks (rate-limited to 60/min/IP). Rewards are qualification-gated: they
 * become claimable only after the referee's account completes a fix run.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { ReferralError, referralService } from './service.js';

const log = rootLogger.child({ module: 'referral-routes' });

export const referralRouter: Router = Router();

const redeemSchema = z.object({
  code: z.string().min(1, 'code is required').max(32),
  email: z.string().email(),
});

const clickSchema = z.object({
  code: z.string().min(1, 'code is required').max(32),
});

const claimParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// In-memory per-IP limiter for the public click endpoint (60 req/min/IP).
const clickLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many requests' });
  },
});

// Tighter in-memory limiter for public redemption (10 req/min/IP) — signup
// traffic for one IP is naturally low, so this only clips abuse.
const redeemLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many requests' });
  },
});

/**
 * Resolve the authenticated caller's accounts.id.
 * Reads from `x-account-id` header (API-key users) or JWT user email.
 */
async function getAccountId(req: Request): Promise<number | null> {
  const header = req.headers['x-account-id'];
  if (header) {
    const id = Number(Array.isArray(header) ? header[0] : header);
    if (Number.isFinite(id) && id > 0 && Number.isInteger(id)) return id;
  }
  if (req.user) {
    try {
      const result = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
        [req.user.email],
      );
      if (result.rows.length > 0) return result.rows[0].id;
    } catch {
      // DB table may not exist — fall through
    }
    // No accounts row yet — create one lazily so referral works for SaaS users.
    return referralService.resolveAccountId(req.user.email);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/referral/code
// ---------------------------------------------------------------------------

referralRouter.get('/referral/code', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const code = await referralService.getOrCreateCode(accountId);
    res.json({ code });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get referral code');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/referral/code
// ---------------------------------------------------------------------------

referralRouter.post('/referral/code', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const code = await referralService.getOrCreateCode(accountId);
    res.status(201).json({ code });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create referral code');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/referral/redeem
// ---------------------------------------------------------------------------

referralRouter.post('/referral/redeem', redeemLimiter, async (req: Request, res: Response) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    await referralService.redeem(parsed.data.code, parsed.data.email);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof ReferralError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err }, 'Referral redeem failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/referral/click
// ---------------------------------------------------------------------------

referralRouter.post('/referral/click', clickLimiter, async (req: Request, res: Response) => {
  const parsed = clickSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const registered = await referralService.registerClick(parsed.data.code);
    if (!registered) {
      res.status(400).json({ error: 'Invalid referral code' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Referral click tracking failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/referral/stats
// ---------------------------------------------------------------------------

referralRouter.get('/referral/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const stats = await referralService.getStats(accountId);
    res.json({ stats });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get referral stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/referral/rewards
// ---------------------------------------------------------------------------

referralRouter.get('/referral/rewards', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rewards = await referralService.listRewards(accountId);
    res.json({ rewards });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list referral rewards');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/referral/rewards/:id/claim
// ---------------------------------------------------------------------------

referralRouter.post('/referral/rewards/:id/claim', requireAuth, async (req: Request, res: Response) => {
  const parsed = claimParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid reward id' });
    return;
  }

  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await referralService.claimReward(accountId, parsed.data.id);
    res.json({ claimed: true, reward: result.reward, newAllowance: result.newAllowance });
  } catch (err) {
    if (err instanceof ReferralError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    log.error({ err: String(err) }, 'Failed to claim referral reward');
    res.status(500).json({ error: 'Internal server error' });
  }
});
