/**
 * MCP API key management routes (dashboard).
 *
 * Authenticated with the dashboard JWT (requireAuth). Serves:
 *   GET    /api/v1/mcp-keys        — list my keys
 *   POST   /api/v1/mcp-keys        — create a key (full key returned once)
 *   GET    /api/v1/mcp-keys/:id    — reveal the full key (show/hide in UI)
 *   PATCH  /api/v1/mcp-keys/:id    — rename a key
 *   DELETE /api/v1/mcp-keys/:id    — revoke (soft-delete) a key
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { createMcpKey, getMcpKeyPlaintext, listMcpKeys, renameMcpKey, revokeMcpKey } from '../services/mcpKeys.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'mcp-keys-routes' });
const router: Router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
});
const renameSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

// GET / — list keys for the authenticated user
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const keys = await listMcpKeys(req.user!.id);
    res.json({ keys });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list MCP keys');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a key (full key returned exactly once)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return;
  }
  try {
    const { record, key } = await createMcpKey(req.user!.id, parse.data.name);
    res.status(201).json({
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      key, // shown once
      createdAt: record.createdAt,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create MCP key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — reveal the full key (show/hide in the Settings UI)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const key = await getMcpKeyPlaintext(req.user!.id, req.params.id);
    if (!key) {
      res.status(404).json({ error: 'This key was created before secure reveal was enabled, so it cannot be shown again. Create a new key to view and copy it.' });
      return;
    }
    res.json({ key });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to reveal MCP key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — rename
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const parse = renameSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return;
  }
  try {
    const record = await renameMcpKey(req.user!.id, req.params.id, parse.data.name);
    if (!record) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    res.json({ id: record.id, name: record.name, keyPrefix: record.keyPrefix, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt, revokedAt: record.revokedAt });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to rename MCP key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — revoke (soft-delete)
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const revoked = await revokeMcpKey(req.user!.id, req.params.id);
    if (!revoked) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to revoke MCP key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
