/**
 * Team management module — multi-tenant team management with RBAC.
 *
 * Provides:
 * - Team creation, listing, and details
 * - Role-based access control (admin, member, viewer)
 * - Team member invitation and removal
 * - Role change management
 * - Billing integration per team
 *
 * @module team
 */

import { teamsRepository } from '../db/repositories/index.js';
import type { Team, TeamMember } from '../db/types/index.js';
import { rootLogger } from '../utils/logger.js';
import { auditRepository, type ActorType } from '../audit/repository.js';
import { config } from '../config.js';

const log = rootLogger.child({ module: 'team' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamRole = 'admin' | 'member' | 'viewer';

export interface TeamWithMemberCount extends Team {
  memberCount: number;
}

export interface TeamMemberWithDetails extends TeamMember {
  accountName?: string;
  accountEmail?: string;
}

export interface InviteResult {
  teamId: number;
  accountId: number;
  role: TeamRole;
}

export interface RoleChangeResult {
  teamId: number;
  accountId: number;
  previousRole: TeamRole;
  newRole: TeamRole;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ROLES: TeamRole[] = ['admin', 'member', 'viewer'];

const ROLE_HIERARCHY: Record<TeamRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidRole(role: string): role is TeamRole {
  return VALID_ROLES.includes(role as TeamRole);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new team.
 * The creator is automatically added as an 'admin' member.
 */
export async function createTeam(params: {
  name: string;
  ownerAccountId: number;
  correlationId?: string;
}): Promise<Team> {
  const slug = slugify(params.name);

  // Check if slug already exists
  const existing = await teamsRepository.findBySlug(slug);
  if (existing) {
    throw new Error(`Team with slug "${slug}" already exists`);
  }

  const team = await teamsRepository.create({
    name: params.name,
    slug,
    ownerAccountId: params.ownerAccountId,
  });

  // Add creator as admin member
  await teamsRepository.addMember(team.id, params.ownerAccountId, 'admin');

  // Audit log
  await safeAuditLog({
    actorType: 'user',
    actorId: String(params.ownerAccountId),
    action: 'team.created',
    resourceType: 'team',
    resourceId: String(team.id),
    details: { teamName: params.name, slug },
    correlationId: params.correlationId,
  });

  log.info(
    { teamId: team.id, name: params.name, ownerAccountId: params.ownerAccountId },
    'Team created',
  );

  return team;
}

/**
 * List teams for an account.
 */
export async function listTeams(accountId: number): Promise<TeamWithMemberCount[]> {
  const teams = await teamsRepository.getTeamsForAccount(accountId);

  const withCounts = await Promise.all(
    teams.map(async (team) => {
      const members = await teamsRepository.getMembers(team.id);
      return { ...team, memberCount: members.length };
    }),
  );

  return withCounts;
}

/**
 * Get team details by ID, including member list.
 */
export async function getTeamDetails(teamId: number): Promise<{
  team: Team;
  members: TeamMemberWithDetails[];
  adminCount: number;
  memberCount: number;
  viewerCount: number;
}> {
  const team = await teamsRepository.findById(teamId);
  if (!team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  const members = await teamsRepository.getMembers(teamId);

  // Enrich members with account details
  const enriched: TeamMemberWithDetails[] = await Promise.all(
    members.map(async (m) => {
      try {
        const { queryWithRetry } = await import('../db/connection.js');
        const result = await queryWithRetry<{ name: string | null; email: string | null }>(
          'SELECT name, email FROM accounts WHERE id = $1',
          [m.accountId],
        );
        return {
          ...m,
          accountName: result.rows[0]?.name ?? undefined,
          accountEmail: result.rows[0]?.email ?? undefined,
        };
      } catch {
        return { ...m, accountName: undefined, accountEmail: undefined };
      }
    }),
  );

  const roleCounts = enriched.reduce(
    (acc, m) => {
      if (m.role === 'admin') acc.adminCount++;
      else if (m.role === 'member') acc.memberCount++;
      else if (m.role === 'viewer') acc.viewerCount++;
      return acc;
    },
    { adminCount: 0, memberCount: 0, viewerCount: 0 },
  );

  return { team, members: enriched, ...roleCounts };
}

/**
 * Invite a member to a team.
 * Validates that the actor has sufficient privileges.
 */
export async function inviteMember(params: {
  teamId: number;
  accountId: number;
  role?: TeamRole;
  invitedByAccountId: number;
  correlationId?: string;
}): Promise<InviteResult> {
  const role = params.role ?? 'member';

  if (!isValidRole(role)) {
    throw new Error(`Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`);
  }

  // Verify team exists
  const team = await teamsRepository.findById(params.teamId);
  if (!team) {
    throw new Error(`Team not found: ${params.teamId}`);
  }

  // Verify actor is a member of this team
  const actorMembership = await getMemberRole(params.teamId, params.invitedByAccountId);
  if (!actorMembership) {
    throw new Error('You are not a member of this team');
  }

  // Verify actor has sufficient privileges to invite
  if (actorMembership !== 'admin') {
    throw new Error('Only admins can invite members');
  }

  // Check team size limits based on account tier
  const { queryWithRetry } = await import('../db/connection.js');
  const ownerResult = await queryWithRetry<{ tier: string }>(
    'SELECT tier FROM accounts WHERE id = $1',
    [team.ownerAccountId],
  );
  const ownerTier = ownerResult.rows[0]?.tier ?? 'free';

  const currentMembers = await teamsRepository.getMembers(params.teamId);
  const maxMembers = ownerTier === 'pro'
    ? config.teams.maxMembers * 3
    : config.teams.maxMembers;

  if (currentMembers.length >= maxMembers) {
    throw new Error(
      `Team has reached the maximum of ${maxMembers} members for the ${ownerTier} tier. ` +
      'Upgrade to add more members.',
    );
  }

  // Add member (upsert via ON CONFLICT)
  await teamsRepository.addMember(params.teamId, params.accountId, role);

  // Audit log
  await safeAuditLog({
    actorType: 'user',
    actorId: String(params.invitedByAccountId),
    action: 'team.member.invited',
    resourceType: 'team',
    resourceId: String(params.teamId),
    details: { invitedAccountId: params.accountId, role },
    correlationId: params.correlationId,
  });

  log.info(
    { teamId: params.teamId, accountId: params.accountId, role },
    'Team member invited',
  );

  return { teamId: params.teamId, accountId: params.accountId, role };
}

/**
 * Change a member's role within a team.
 */
export async function changeMemberRole(params: {
  teamId: number;
  targetAccountId: number;
  newRole: TeamRole;
  changedByAccountId: number;
  correlationId?: string;
}): Promise<RoleChangeResult> {
  if (!isValidRole(params.newRole)) {
    throw new Error(`Invalid role "${params.newRole}". Valid roles: ${VALID_ROLES.join(', ')}`);
  }

  // Verify team exists
  const team = await teamsRepository.findById(params.teamId);
  if (!team) {
    throw new Error(`Team not found: ${params.teamId}`);
  }

  // Verify actor is an admin of this team
  const actorRole = await getMemberRole(params.teamId, params.changedByAccountId);
  if (actorRole !== 'admin') {
    throw new Error('Only admins can change member roles');
  }

  // Get target member's current role
  const targetMembership = await getMemberRole(params.teamId, params.targetAccountId);
  if (!targetMembership) {
    throw new Error('Target user is not a member of this team');
  }

  // Cannot change the owner's role (owner is always admin)
  if (params.targetAccountId === team.ownerAccountId) {
    throw new Error("Cannot change the team owner's role");
  }

  // Cannot demote the last admin
  if (targetMembership === 'admin' && params.newRole !== 'admin') {
    const members = await teamsRepository.getMembers(params.teamId);
    const adminCount = members.filter((m) => m.role === 'admin' && m.accountId !== params.targetAccountId).length;
    if (adminCount === 0) {
      throw new Error('Cannot demote the last admin of the team');
    }
  }

  const previousRole = targetMembership;

  // Update role by re-adding with upsert
  await teamsRepository.addMember(params.teamId, params.targetAccountId, params.newRole);

  // Audit log
  await safeAuditLog({
    actorType: 'user',
    actorId: String(params.changedByAccountId),
    action: 'team.member.role_changed',
    resourceType: 'team',
    resourceId: String(params.teamId),
    details: { targetAccountId: params.targetAccountId, previousRole, newRole: params.newRole },
    correlationId: params.correlationId,
  });

  log.info(
    { teamId: params.teamId, targetAccountId: params.targetAccountId, previousRole, newRole: params.newRole },
    'Team member role changed',
  );

  return { teamId: params.teamId, accountId: params.targetAccountId, previousRole, newRole: params.newRole };
}

/**
 * Remove a member from a team.
 */
export async function removeMember(params: {
  teamId: number;
  targetAccountId: number;
  removedByAccountId: number;
  correlationId?: string;
}): Promise<boolean> {
  // Verify team exists
  const team = await teamsRepository.findById(params.teamId);
  if (!team) {
    throw new Error(`Team not found: ${params.teamId}`);
  }

  // Verify actor is an admin of this team
  const actorRole = await getMemberRole(params.teamId, params.removedByAccountId);
  if (actorRole !== 'admin') {
    throw new Error('Only admins can remove members');
  }

  // Cannot remove the team owner
  if (params.targetAccountId === team.ownerAccountId) {
    throw new Error('Cannot remove the team owner');
  }

  // Cannot remove the last admin
  const targetRole = await getMemberRole(params.teamId, params.targetAccountId);
  if (targetRole === 'admin') {
    const members = await teamsRepository.getMembers(params.teamId);
    const adminCount = members.filter(
      (m) => m.role === 'admin' && m.accountId !== params.targetAccountId,
    ).length;
    if (adminCount === 0) {
      throw new Error('Cannot remove the last admin of the team');
    }
  }

  const removed = await teamsRepository.removeMember(params.teamId, params.targetAccountId);

  if (removed) {
    // Audit log
    await safeAuditLog({
      actorType: 'user',
      actorId: String(params.removedByAccountId),
      action: 'team.member.removed',
      resourceType: 'team',
      resourceId: String(params.teamId),
      details: { removedAccountId: params.targetAccountId, previousRole: targetRole },
      correlationId: params.correlationId,
    });

    log.info(
      { teamId: params.teamId, removedAccountId: params.targetAccountId },
      'Team member removed',
    );
  }

  return removed;
}

/**
 * Check if an account has a specific role in a team.
 */
export async function hasRole(teamId: number, accountId: number, requiredRole: TeamRole): Promise<boolean> {
  const role = await getMemberRole(teamId, accountId);
  if (!role) return false;
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Get the member count for a team.
 */
export async function getTeamMemberCount(teamId: number): Promise<number> {
  const members = await teamsRepository.getMembers(teamId);
  return members.length;
}

/**
 * List all teams in the system (admin use).
 */
export async function listAllTeams(limit = 50, offset = 0): Promise<{ teams: TeamWithMemberCount[]; total: number }> {
  const teams = await teamsRepository.list(limit, offset);

  const { queryWithRetry } = await import('../db/connection.js');
  const countResult = await queryWithRetry<{ total: number }>('SELECT COUNT(*) as total FROM teams');
  const total = Number(countResult.rows[0]?.total ?? 0);

  const withCounts = await Promise.all(
    teams.map(async (team) => {
      const members = await teamsRepository.getMembers(team.id);
      return { ...team, memberCount: members.length };
    }),
  );

  return { teams: withCounts, total };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getMemberRole(teamId: number, accountId: number): Promise<TeamRole | undefined> {
  const members = await teamsRepository.getMembers(teamId);
  const member = members.find((m) => m.accountId === accountId);
  return member?.role as TeamRole | undefined;
}

async function safeAuditLog(entry: {
  actorType: ActorType | 'user';
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  try {
    await auditRepository.insert({
      actorType: entry.actorType as ActorType,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details,
      correlationId: entry.correlationId,
    });
  } catch (err) {
    log.error({ err: String(err), action: entry.action }, 'Failed to write team audit log');
  }
}

export { teamRouter } from './routes.js';
