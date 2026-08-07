import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { getDpaStatus, acceptDpa, DPA_CURRENT_VERSION } from '../billing/dpa.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';

const log = rootLogger.child({ module: 'dpa-api' });
const router: Router = Router();

async function getAccountId(req: Request): Promise<number | undefined> {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) { const id = Number(headerId); if (!Number.isNaN(id)) return id; }
  const queryId = req.query.accountId as string | undefined;
  if (queryId) { const id = Number(queryId); if (!Number.isNaN(id)) return id; }
  if (req.user) {
    const result = await queryWithRetry<{ id: number }>(
      'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
      [req.user.email],
    );
    if (result.rows.length > 0) return result.rows[0].id;
  }
  return undefined;
}

router.get('/dpa', optionalAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) { res.json({ accepted: false, currentVersion: DPA_CURRENT_VERSION, requiresAcceptance: true, record: null }); return; }
    const status = await getDpaStatus(accountId);
    res.json({ accepted: status.accepted, currentVersion: status.currentVersion, requiresAcceptance: !status.accepted, record: status.record });
  } catch (err) { log.error({ err: String(err) }, 'Failed to get DPA status'); res.status(500).json({ error: 'Failed to get DPA status' }); }
});

router.post('/dpa/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) { res.status(400).json({ error: 'Account identification required' }); return; }
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? undefined;
    const result = await acceptDpa(accountId, ipAddress);
    res.json(result);
  } catch (err) { log.error({ err: String(err) }, 'Failed to accept DPA'); res.status(500).json({ error: 'Failed to accept DPA' }); }
});

router.get('/dpa/version', (_req: Request, res: Response) => { res.json({ version: DPA_CURRENT_VERSION }); });
export { router as dpaRouter };
