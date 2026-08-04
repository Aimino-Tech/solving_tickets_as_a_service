import { Mail, RotateCw, Shield, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type TeamInvite, type TeamMember, type TeamSummary, teamApi } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { formatRelativeTime } from '@/utils/format';

type Role = 'admin' | 'member' | 'viewer';

const SKELETON_ROWS = ['skeleton-0', 'skeleton-1', 'skeleton-2'];

export default function Members() {
  const [team, setTeam] = useState<TeamSummary | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<Record<number, string>>({});

  const isAdmin = team?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let myTeam = team;
      if (!myTeam) {
        const me = await teamApi.me();
        myTeam = me.team;
        setTeam(myTeam);
      }
      const data = await teamApi.members(myTeam.id);
      setMembers(data.members);
      setInvites(data.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => {
    const ac = new AbortController();
    load();
    return () => ac.abort();
  }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!team || !inviteEmail.trim()) return;
    setInviting(true);
    setNotice(null);
    try {
      await teamApi.invite(team.id, { email: inviteEmail.trim() });
      setInviteEmail('');
      setNotice({ type: 'success', text: `Invitation sent to ${inviteEmail.trim()}` });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to invite member' });
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: TeamMember, role: Role) {
    if (!team) return;
    setBusyKey(`role-${member.accountId}`);
    setNotice(null);
    try {
      await teamApi.changeRole(team.id, member.accountId, role);
      setNotice({ type: 'success', text: `${member.accountEmail ?? member.email ?? 'Member'} is now ${role}` });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change role' });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSetLimit(member: TeamMember) {
    if (!team) return;
    const raw = limitDraft[member.accountId];
    setBusyKey(`limit-${member.accountId}`);
    setNotice(null);
    try {
      const value = raw === undefined || raw === '' ? null : Number(raw);
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        setNotice({ type: 'error', text: 'Monthly limit must be a non-negative integer' });
        return;
      }
      await teamApi.setLimit(team.id, member.accountId, value);
      setLimitDraft((prev) => {
        const next = { ...prev };
        delete next[member.accountId];
        return next;
      });
      setNotice({ type: 'success', text: 'Monthly limit updated' });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update limit' });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeInvite(invite: TeamInvite) {
    if (!team) return;
    if (!window.confirm(`Revoke the pending invite for ${invite.email}?`)) return;
    setBusyKey(`invite-${invite.id}`);
    setNotice(null);
    try {
      await teamApi.revokeInvite(team.id, invite.id);
      setNotice({ type: 'success', text: `Invite for ${invite.email} revoked` });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke invite' });
    } finally {
      setBusyKey(null);
    }
  }

  function roleBadge(role: string) {
    if (role === 'admin') {
      return (
        <span className="badge-info">
          <Shield size={12} className="mr-1 inline" />
          Admin
        </span>
      );
    }
    if (role === 'member') {
      return <span className="badge-success">Member</span>;
    }
    return <span className="badge-neutral">Viewer</span>;
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {SKELETON_ROWS.map((skeletonKey) => (
          <div key={skeletonKey} className="card animate-pulse">
            <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-2 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  if (error && !team) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Team Members</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage who has access to your workspace.</p>
          </div>
        </div>
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Team Members</h2>
        <EmptyState title="You are not a member of any team yet." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Team Members</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {team.name} &middot; {members.length} member{members.length === 1 ? '' : 's'}
            {invites.length > 0 && ` &middot; ${invites.length} pending invite${invites.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {notice && (
        <div
          className={`card border ${notice.type === 'success' ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'}`}
        >
          <p
            className={
              notice.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }
          >
            {notice.text}
          </p>
        </div>
      )}

      {error && (
        <div className="card border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {isAdmin && (
        <form onSubmit={handleInvite} className="card">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <UserPlus size={16} /> Invite member
          </h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="input-field pl-9"
                required
              />
            </div>
            <button type="submit" disabled={inviting || !inviteEmail.trim()} className="btn-primary">
              {inviting ? 'Sending…' : 'Invite member'}
            </button>
          </div>
        </form>
      )}

      {invites.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Pending invites ({invites.length})
          </h3>
          <div className="space-y-2">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{invite.email}</span>
                  <span className="badge-warning">Invited</span>
                  {invite.monthlyLimitCredits !== null && (
                    <span className="text-xs text-gray-400">{invite.monthlyLimitCredits} credits/mo</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Invited {formatRelativeTime(invite.createdAt)}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite)}
                      disabled={busyKey === `invite-${invite.id}`}
                      className="btn-danger text-xs"
                    >
                      {busyKey === `invite-${invite.id}` ? '…' : 'Revoke'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Monthly limit</th>
              {isAdmin && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 4 : 3} className="px-4 py-8 text-center text-gray-400">
                  No members yet. Invite your first teammate to get started.
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.accountId} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-gray-900 dark:text-gray-100">
                      {member.accountEmail ?? member.email ?? `Account #${member.accountId}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">{roleBadge(member.role)}</td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={
                            limitDraft[member.accountId] !== undefined
                              ? limitDraft[member.accountId]
                              : member.monthlyLimitCredits === null
                                ? ''
                                : member.monthlyLimitCredits
                          }
                          onChange={(e) => setLimitDraft((prev) => ({ ...prev, [member.accountId]: e.target.value }))}
                          placeholder="Unlimited"
                          className="input-field w-28 py-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleSetLimit(member)}
                          disabled={busyKey === `limit-${member.accountId}`}
                          className="btn-secondary text-xs px-2 py-1"
                          title="Save limit"
                        >
                          {busyKey === `limit-${member.accountId}` ? '…' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-700 dark:text-gray-300">
                        {member.monthlyLimitCredits === null ? 'Unlimited' : `${member.monthlyLimitCredits} credits/mo`}
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member, e.target.value as Role)}
                          disabled={busyKey === `role-${member.accountId}`}
                          className="input-field w-28 py-1"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        {busyKey === `role-${member.accountId}` && (
                          <RotateCw size={14} className="animate-spin text-gray-400" />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
