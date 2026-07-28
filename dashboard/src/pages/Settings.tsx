import { useState, useEffect } from 'react';
import { settings } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { fetchPreferences, upsertPreference, type NotificationPreference } from '@/services/notificationService';

const CHANNELS: { id: NotificationPreference['channel']; label: string; icon: string }[] = [
  { id: 'in_app', label: 'In-App', icon: '🔔' },
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'slack', label: 'Slack', icon: '💬' },
  { id: 'discord', label: 'Discord', icon: '🎮' },
  { id: 'webhook', label: 'Webhook', icon: '🔗' },
];

const EVENT_TYPES = [
  'fix_started',
  'pr_created',
  'fix_completed',
  'review_needed',
  'rework_required',
  'merge_completed',
  'pipeline_failed',
  'low_credits',
  'payment_failed',
];

export default function Settings() {
  const [config, setConfig] = useState<{
    label: string;
    model: string;
    maxConcurrent: number;
    sandboxPoolSize: number;
    auditLogEnabled: boolean;
  } | null>(null);
  const [form, setForm] = useState({
    label: 'stas:fix',
    model: '',
    maxConcurrent: 3,
    sandboxPoolSize: 10,
    auditLogEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<{
    activeRequest: {
      id: number;
      status: string;
      scheduled_deletion_at: string;
    } | null;
    retentionDays: number;
  } | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreference[]>([]);
  const [notificationChannels, setNotificationChannels] = useState<Record<string, Record<string, boolean>>>({});
  const [channelTargets, setChannelTargets] = useState<Record<string, string>>({});
  const [savingNotif, setSavingNotif] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    config: true,
    notifications: false,
    privacy: false,
    danger: false,
  });
  useAuth();

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    const ac = new AbortController();
    settings
      .get(ac.signal)
      .then((data: any) => {
        if (ac.signal.aborted) return;
        setConfig(data);
        setForm(data);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    fetchDeletionStatus(ac.signal);
    loadNotificationPrefs(ac.signal);
    return () => ac.abort();
  }, []);

  async function loadNotificationPrefs(signal?: AbortSignal) {
    const prefs = await fetchPreferences(signal);
    if (signal?.aborted) return;
    setNotificationPrefs(prefs);
    const channels: Record<string, Record<string, boolean>> = {};
    const targets: Record<string, string> = {};
    for (const p of prefs) {
      if (!channels[p.channel]) channels[p.channel] = {};
      channels[p.channel][p.eventType] = p.enabled;
      if (p.channelTarget) targets[p.channel] = p.channelTarget;
    }
    setNotificationChannels(channels);
    setChannelTargets(targets);
  }

  async function handleTogglePref(channel: NotificationPreference['channel'], eventType: string, enabled: boolean) {
    setSavingNotif(true);
    await upsertPreference(channel, eventType, enabled, channelTargets[channel] || undefined);
    await loadNotificationPrefs();
    setSavingNotif(false);
  }

  async function handleChannelTargetChange(channel: string, target: string) {
    setChannelTargets((prev) => ({ ...prev, [channel]: target }));
  }

  async function handleChannelTargetBlur(channel: NotificationPreference['channel']) {
    const target = channelTargets[channel];
    if (target) {
      setSavingNotif(true);
      for (const eventType of EVENT_TYPES) {
        const current = notificationChannels[channel]?.[eventType];
        if (current !== undefined) {
          await upsertPreference(channel, eventType, current, target);
        }
      }
      await loadNotificationPrefs();
      setSavingNotif(false);
    }
  }

  async function fetchDeletionStatus(signal?: AbortSignal) {
    try {
      const token = localStorage.getItem('stas_token');
      const res = await fetch('/api/v1/me/data/deletion-status', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal,
      });
      if (res.ok) {
        setDeletionStatus(await res.json());
      }
    } catch {
      // Non-critical background fetch
    }
  }

  async function handleRequestDeletion() {
    if (!window.confirm('Are you sure you want to request data deletion? This will schedule all your data for permanent removal.')) return;
    try {
      const token = localStorage.getItem('stas_token');
      const res = await fetch('/api/v1/me/data/deletion-request', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setError(null);
      await fetchDeletionStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request deletion');
    }
  }

  async function handleCancelDeletion() {
    try {
      const token = localStorage.getItem('stas_token');
      const res = await fetch('/api/v1/me/data/deletion-request/cancel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setError(null);
      await fetchDeletionStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel deletion request');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await settings.update(form);
      setSuccess('Settings saved successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card animate-pulse space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i}>
            <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-1 h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4 lg:space-y-6">
      {/* Bot Configuration */}
      <div className="card">
        <button
          onClick={() => toggleSection('config')}
          className="flex w-full items-center justify-between lg:cursor-default"
        >
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Bot Configuration</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 hidden lg:block">
              Configure how the STAS bot behaves for your repositories.
            </p>
          </div>
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform lg:hidden ${openSections.config ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {openSections.config && (
          <>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 lg:hidden">
              Configure how the STAS bot behaves for your repositories.
            </p>
            <form onSubmit={handleSave} className="mt-6 space-y-5">
              {/* Trigger label */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Trigger Label</label>
                <p className="text-xs text-gray-500 dark:text-gray-400">Issue label that triggers the bot.</p>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className="input-field mt-1 max-w-xs min-h-[44px]"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
                <p className="text-xs text-gray-500 dark:text-gray-400">AI model used for fix runs.</p>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="input-field mt-1 w-full max-w-md min-h-[44px]"
                  placeholder="e.g. aimino/agi-v1"
                />
              </div>

              {/* Max concurrent */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Max Concurrent Fixes</label>
                <p className="text-xs text-gray-500 dark:text-gray-400">Maximum number of fixes running simultaneously.</p>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxConcurrent}
                  onChange={(e) => setForm({ ...form, maxConcurrent: Number(e.target.value) })}
                  className="input-field mt-1 max-w-[120px] min-h-[44px]"
                />
              </div>

              {/* Sandbox pool */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sandbox Pool Size</label>
                <p className="text-xs text-gray-500 dark:text-gray-400">Number of pre-warmed sandbox environments.</p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.sandboxPoolSize}
                  onChange={(e) => setForm({ ...form, sandboxPoolSize: Number(e.target.value) })}
                  className="input-field mt-1 max-w-[120px] min-h-[44px]"
                />
              </div>

              {/* Audit log toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="auditLog"
                  checked={form.auditLogEnabled}
                  onChange={(e) => setForm({ ...form, auditLogEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <label htmlFor="auditLog" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable audit logging
                </label>
              </div>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={() => setForm(config)}
                    className="btn-secondary"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>

      {/* Notification Preferences */}
      <div className="card">
        <button
          onClick={() => toggleSection('notifications')}
          className="flex w-full items-center justify-between lg:cursor-default"
        >
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Notification Preferences</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 hidden lg:block">
              Choose which channels and events send you notifications.
            </p>
          </div>
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform lg:hidden ${openSections.notifications ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {openSections.notifications && (
          <>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 lg:hidden">
              Choose which channels and events send you notifications.
            </p>
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              Toggle individual event types per notification channel.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">Channel</th>
                    {EVENT_TYPES.map((et) => (
                      <th key={et} className="px-2 py-2 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                        {et.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CHANNELS.map((ch) => (
                    <tr key={ch.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-3 pr-4">
                        <span className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                          <span>{ch.icon}</span>
                          {ch.label}
                        </span>
                        {(ch.id === 'slack' || ch.id === 'discord' || ch.id === 'webhook') && (
                          <input
                            type="text"
                            placeholder={`${ch.label} webhook URL...`}
                            value={channelTargets[ch.id] || ''}
                            onChange={(e) => handleChannelTargetChange(ch.id, e.target.value)}
                            onBlur={() => handleChannelTargetBlur(ch.id)}
                            className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                          />
                        )}
                        {ch.id === 'email' && (
                          <input
                            type="email"
                            placeholder="Email address..."
                            value={channelTargets[ch.id] || ''}
                            onChange={(e) => handleChannelTargetChange(ch.id, e.target.value)}
                            onBlur={() => handleChannelTargetBlur(ch.id)}
                            className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                          />
                        )}
                      </td>
                      {EVENT_TYPES.map((et) => {
                        const enabled = notificationChannels[ch.id]?.[et] ?? (ch.id === 'in_app' ? true : false);
                        return (
                          <td key={et} className="px-2 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={savingNotif || ch.id === 'in_app'}
                              onChange={() => handleTogglePref(ch.id, et, !enabled)}
                              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {savingNotif && (
              <p className="mt-2 text-xs text-gray-400">Saving...</p>
            )}
          </>
        )}
      </div>

      {/* Data Privacy */}
      <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-4 lg:p-6">
        <button
          onClick={() => toggleSection('privacy')}
          className="flex w-full items-center justify-between lg:cursor-default"
        >
          <div>
            <h3 className="text-base font-semibold text-red-800 dark:text-red-200">Data Privacy</h3>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300 hidden lg:block">
              Manage your data retention and deletion preferences.
            </p>
          </div>
          <svg
            className={`h-5 w-5 text-red-400 transition-transform lg:hidden ${openSections.privacy ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {openSections.privacy && (
          <>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300 lg:hidden">
              Manage your data retention and deletion preferences.
            </p>
            {deletionStatus && (
              <div className="mt-4 rounded-lg border border-red-200 bg-white dark:bg-gray-800 p-4">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {deletionStatus.activeRequest?.status === 'completed'
                    ? 'Data deletion completed'
                    : deletionStatus.activeRequest?.status === 'pending'
                      ? 'Deletion requested'
                      : 'No active deletion request'}
                </p>
                {deletionStatus.activeRequest?.status === 'pending' && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Scheduled for{' '}
                    {new Date(deletionStatus.activeRequest.scheduled_deletion_at).toLocaleDateString()}
                    {' '}({deletionStatus.retentionDays}-day retention policy)
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  {deletionStatus.activeRequest?.status === 'pending' ? (
                    <button onClick={handleCancelDeletion} className="btn-secondary text-xs">
                      Cancel Deletion Request
                    </button>
                  ) : (
                    <button onClick={handleRequestDeletion} className="btn-danger text-xs">
                      Request Data Deletion
                    </button>
                  )}
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Data is retained for {deletionStatus?.retentionDays ?? 30} days after cancellation,
              then permanently purged. You can cancel a deletion request at any time before the
              scheduled date.
            </p>
          </>
        )}
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-4 lg:p-6">
        <button
          onClick={() => toggleSection('danger')}
          className="flex w-full items-center justify-between lg:cursor-default"
        >
          <div>
            <h3 className="text-base font-semibold text-red-800 dark:text-red-200">Danger Zone</h3>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300 hidden lg:block">
              These actions are irreversible. Proceed with caution.
            </p>
          </div>
          <svg
            className={`h-5 w-5 text-red-400 transition-transform lg:hidden ${openSections.danger ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {openSections.danger && (
          <div className="mt-4 flex">
            <button className="btn-danger text-xs">Reset All Settings</button>
          </div>
        )}
      </div>
    </div>
  );
}
