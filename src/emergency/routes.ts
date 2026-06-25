/**
 * Emergency Stop — Express API endpoints.
 *
 * Provides REST API for activating, deactivating, and checking the
 * status of the emergency kill switch.
 *
 * Endpoints:
 *   POST   /api/emergency-stop          — Activate kill switch
 *   POST   /api/emergency-stop/resume   — Deactivate kill switch
 *   GET    /api/emergency-stop/status   — Current status
 *
 * All endpoints are protected by the admin auth middleware, consistent
 * with other administrative routes in the project.
 */

import { Router, type Request, type Response } from 'express';
import { EmergencyStop } from './stop.js';
import { notifyActiveIssues } from './notify.js';
import { holdPendingMessages, resumeHeldMessages } from './queue.js';
import { rootLogger } from '../utils/logger.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';

const log = rootLogger.child({ module: 'emergency-routes' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// All emergency endpoints require admin auth
// ---------------------------------------------------------------------------
router.use(adminAuthMiddleware);

// ---------------------------------------------------------------------------
// POST /api/emergency-stop
// Body: { reason?: string }
// ---------------------------------------------------------------------------

interface EmergencyActivateBody {
  reason?: string;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as EmergencyActivateBody;
    const reasonStr = reason || 'Activated via API by admin';

    await EmergencyStop.activate(reasonStr);

    // Move pending messages to hold queue
    try {
      await holdPendingMessages();
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to move pending messages (non-fatal)');
    }

    // Notify active Linear issues
    try {
      await notifyActiveIssues(reasonStr);
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to notify active issues (non-fatal)');
    }

    res.json({
      success: true,
      message: 'Emergency stop activated — all agents halted',
      reason: reasonStr,
      activatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to activate emergency stop');
    res.status(500).json({ error: 'Failed to activate emergency stop', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/emergency-stop/resume
// ---------------------------------------------------------------------------

router.post('/resume', async (_req: Request, res: Response) => {
  try {
    await EmergencyStop.deactivate();

    // Resume held messages from the hold queue
    try {
      await resumeHeldMessages();
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to resume held messages (non-fatal)');
    }

    res.json({
      success: true,
      message: 'Emergency stop deactivated — agents resumed',
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to deactivate emergency stop');
    res.status(500).json({ error: 'Failed to deactivate emergency stop', detail: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/emergency-stop/status
// ---------------------------------------------------------------------------

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await EmergencyStop.getStatus();

    res.json({
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get emergency stop status');
    res.status(500).json({ error: 'Failed to get emergency stop status', detail: String(err) });
  }
});

export { router as emergencyRouter };
