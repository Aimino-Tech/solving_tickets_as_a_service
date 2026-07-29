/**
 * Trust dashboard API routes — currently disabled.
 *
 * The SQLite-backed TrustStore has been removed.  These routes will be
 * re-implemented against Postgres when needed.
 */
import { Router } from 'express';

const router: Router = Router();

router.all('*', (_req, res) => {
  res.status(503).json({ error: 'Trust dashboard is not available in this build' });
});

export { router as trustRouter };
