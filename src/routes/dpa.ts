import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { getDpaStatus, acceptDpa, DPA_CURRENT_VERSION } from '../billing/dpa.js';

const log = rootLogger.child({ module: 'dpa-api' });
const router = Router();

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) { const id = Number(headerId); if (!Number.isNaN(id)) return id; }
  const queryId = req.query.accountId as string | undefined;
  if (queryId) { const id = Number(queryId); if (!Number.isNaN(id)) return id; }
  return undefined;
}

router.get('/dpa', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) { res.json({ accepted: false, currentVersion: DPA_CURRENT_VERSION, requiresAcceptance: true, record: null }); return; }
    const status = await getDpaStatus(accountId);
    res.json({ accepted: status.accepted, currentVersion: status.currentVersion, requiresAcceptance: !status.accepted, record: status.record });
  } catch (err) { log.error({ err: String(err) }, 'Failed to get DPA status'); res.status(500).json({ error: 'Failed to get DPA status' }); }
});

router.post('/dpa/accept', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) { res.status(400).json({ error: 'Account identification required' }); return; }
    const ipAddress = req.ip ?? req.socket.remoteAddress ?? undefined;
    const result = await acceptDpa(accountId, ipAddress);
    res.json(result);
  } catch (err) { log.error({ err: String(err) }, 'Failed to accept DPA'); res.status(500).json({ error: 'Failed to accept DPA' }); }
});

router.get('/dpa/version', (_req: Request, res: Response) => { res.json({ version: DPA_CURRENT_VERSION }); });
export { router as dpaRouter };
