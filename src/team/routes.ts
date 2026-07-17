/**
 * Team management API routes.
 *
 * All routes are mounted at /api/teams and require the x-account-id
 * header (set by gateway/auth middleware) for account identification.
 *
 * Routes:
 *   POST   /api/teams                          — Create a new team
 *   GET    /api/teams                          — List teams for the current account
 *   GET    /api/teams/:id                       — Get team details with members
 *   POST   /api/teams/:id/invite               — Invite a member to a team
 *   POST   /api/teams/:id/members/:userId/role  — Change a member's role
 *   DELETE /api/teams/:id/members/:userId       — Remove a member from a team
 *
 * @module team/routes
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';
import {
  createTeam,
  listTeams,
  getTeamDetails,
  inviteMember,
  changeMemberRole,
  removeMember,
} from './index.js';
import type { TeamRole } from './index.js';

const log = rootLogger.child({ module: 'team-api' });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// ---------------------------------------------------------------------------
// Helper: extract account ID from request
// ---------------------------------------------------------------------------

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) {
    const id = Number(headerId);
    if (!Number.isNaN(id)) return id;
  }

  const queryId = req.query.accountId as string | undefined;
  if (queryId) {
    const id = Number(queryId);
    if (!Number.isNaN(id)) return id;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// POST /api/teams — Create a new team
// ---------------------------------------------------------------------------

/**
 * Creates a new team and adds the creator as the admin member.
 * Body: { name: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required. Provide x-account-id header or accountId query param.' });
      return;
    }

    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Team name is required and must be a non-empty string' });
      return;
    }

    if (name.length > 100) {
      res.status(400).json({ error: 'Team name must be 100 characters or fewer' });
      return;
    }

    const team = await createTeam({
      name: name.trim(),
      ownerAccountId: accountId,
      correlationId: req.requestId,
    });

    res.status(201).json({ team });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'Failed to create team');

    if (message.includes('already exists')) {
      res.status(409).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to create team' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/teams — List teams for the current account
// ---------------------------------------------------------------------------

/**
 * Returns all teams the authenticated account belongs to.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const teams = await listTeams(accountId);
    res.json({ teams });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list teams');
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/teams/:id — Get team details
// ---------------------------------------------------------------------------

/**
 * Returns team details including member list with roles.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const teamId = Number(req.params.id);
    if (Number.isNaN(teamId) || teamId <= 0) {
      res.status(400).json({ error: 'Invalid team ID' });
      return;
    }

    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const { hasRole } = await import('./index.js');
    const isMember = await hasRole(teamId, accountId, 'viewer');
    if (!isMember) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }

    const details = await getTeamDetails(teamId);
    res.json(details);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, teamId: req.params.id }, 'Failed to get team details');

    if (message.startsWith('Team not found')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to get team details' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/teams/:id/invite — Invite a member
// ---------------------------------------------------------------------------

/**
 * Invite a user to join a team.
 * Body: { accountId: number, role?: 'admin' | 'member' | 'viewer' }
 */
router.post('/:id/invite', async (req: Request, res: Response) => {
  try {
    const teamId = Number(req.params.id);
    if (Number.isNaN(teamId) || teamId <= 0) {
      res.status(400).json({ error: 'Invalid team ID' });
      return;
    }

    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const { accountId: targetAccountId, role } = req.body as {
      accountId?: number;
      role?: string;
    };

    if (!targetAccountId || typeof targetAccountId !== 'number') {
      res.status(400).json({ error: 'accountId is required and must be a number' });
      return;
    }

    // Validate role if provided
    if (role && !['admin', 'member', 'viewer'].includes(role)) {
      res.status(400).json({
        error: 'Invalid role. Valid roles: admin, member, viewer',
      });
      return;
    }

    const result = await inviteMember({
      teamId,
      accountId: targetAccountId,
      role: role as TeamRole | undefined,
      invitedByAccountId: accountId,
      correlationId: req.requestId,
    });

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, teamId: req.params.id }, 'Failed to invite member');

    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('not a member') || message.includes('Only admins')) {
      res.status(403).json({ error: message });
      return;
    }
    if (message.includes('maximum')) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to invite member' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/teams/:id/members/:userId/role — Change member role
// ---------------------------------------------------------------------------

/**
 * Change a team member's role.
 * Body: { role: 'admin' | 'member' | 'viewer' }
 */
router.post('/:id/members/:userId/role', async (req: Request, res: Response) => {
  try {
    const teamId = Number(req.params.id);
    if (Number.isNaN(teamId) || teamId <= 0) {
      res.status(400).json({ error: 'Invalid team ID' });
      return;
    }

    const targetAccountId = Number(req.params.userId);
    if (Number.isNaN(targetAccountId) || targetAccountId <= 0) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const { role } = req.body as { role?: string };
    if (!role || !['admin', 'member', 'viewer'].includes(role)) {
      res.status(400).json({
        error: 'role is required and must be one of: admin, member, viewer',
      });
      return;
    }

    const result = await changeMemberRole({
      teamId,
      targetAccountId,
      newRole: role as TeamRole,
      changedByAccountId: accountId,
      correlationId: req.requestId,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, teamId: req.params.id }, 'Failed to change member role');

    if (message.startsWith('Team not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('Only admins')) {
      res.status(403).json({ error: message });
      return;
    }
    if (message.includes('not a member')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to change member role' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/teams/:id/members/:userId — Remove a member
// ---------------------------------------------------------------------------

/**
 * Remove a member from a team.
 */
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const teamId = Number(req.params.id);
    if (Number.isNaN(teamId) || teamId <= 0) {
      res.status(400).json({ error: 'Invalid team ID' });
      return;
    }

    const targetAccountId = Number(req.params.userId);
    if (Number.isNaN(targetAccountId) || targetAccountId <= 0) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const removed = await removeMember({
      teamId,
      targetAccountId,
      removedByAccountId: accountId,
      correlationId: req.requestId,
    });

    if (!removed) {
      res.status(404).json({ error: 'Member not found in team' });
      return;
    }

    res.json({ success: true, teamId, removedAccountId: targetAccountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, teamId: req.params.id }, 'Failed to remove member');

    if (message.startsWith('Team not found')) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes('Only admins')) {
      res.status(403).json({ error: message });
      return;
    }
    if (message.includes('team owner') || message.includes('last admin')) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to remove member' });
  }
});

export { router as teamRouter };
