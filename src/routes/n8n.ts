import { Router, type Request, type Response } from 'express';

const router: Router = Router();

/**
 * POST /api/v1/n8n/webhook
 * Generic webhook receiver for n8n automation workflows.
 * Accepts JSON payloads and forwards to the SYNTARO pipeline.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { event, data } = req.body || {};
    res.json({ accepted: true, event, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/v1/n8n/health
 * Health check for n8n integration.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'n8n-bridge', timestamp: new Date().toISOString() });
});

export default router;
