import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import { requireAuth } from '../auth/middleware.js';
import { queryWithRetry } from '../db/connection.js';
import { notificationPreferencesRepository } from '../db/repositories/NotificationPreferencesRepository.js';
import { notificationHistoryRepository } from '../db/repositories/NotificationHistoryRepository.js';
import type { NewNotificationPreference } from '../db/types/notifications.js';

const log = rootLogger.child({ module: 'notifications-api' });

const router: Router = Router();

router.use(requireAuth);

async function getUserId(req: Request): Promise<number | undefined> {
  if (!(req as any).user?.id) return undefined;
  const authUserId = (req as any).user.id;
  // Try direct numeric conversion
  const directId = Number(authUserId);
  if (Number.isFinite(directId) && directId > 0 && Number.isInteger(directId)) {
    return directId;
  }
  // UUID user ID — look up by email
  const email = (req as any).user?.email;
  if (email) {
    try {
      const result = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
        [email],
      );
      if (result.rows.length > 0) return result.rows[0].id;
    } catch {
      // DB not available
    }
  }
  return undefined;
}

router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const preferences = await notificationPreferencesRepository.findByUser(userId);
    res.json({ preferences });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list notification preferences');
    res.status(500).json({ error: 'Failed to list notification preferences' });
  }
});

router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { channel, eventType, enabled, channelTarget } = req.body;
    if (!channel || !eventType) {
      res.status(400).json({ error: 'channel and eventType are required' });
      return;
    }
    const data: NewNotificationPreference = {
      userId, channel, eventType, enabled, channelTarget,
    };
    const preference = await notificationPreferencesRepository.upsert(data);
    res.json({ preference });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update notification preference');
    res.status(500).json({ error: 'Failed to update notification preference' });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);
    const unreadOnly = req.query.unread === 'true';
    const result = await notificationHistoryRepository.findByUser(userId, limit, offset, unreadOnly);
    res.json({ ...result, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list notification history');
    res.status(500).json({ error: 'Failed to list notification history' });
  }
});

router.put('/history/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    await notificationHistoryRepository.markRead(id, userId);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to mark notification as read');
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.put('/history/read-all', async (req: Request, res: Response) => {
  try {
    const userId = await getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await notificationHistoryRepository.markAllRead(userId);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to mark all notifications as read');
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export { router as notificationsRouter };
