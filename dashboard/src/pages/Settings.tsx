import { useState, useEffect, useRef } from 'react';
import { request, configApi } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { fetchPreferences, upsertPreference, type NotificationPreference } from '@/services/notificationService';
import {
  Bell,
  Mail,
  MessageSquare,
  Gamepad,
  Link as LinkIcon,
  Shield,
  GitPullRequest,
  GitBranch,
  Key,
  Pencil,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CHANNELS: { id: NotificationPreference['channel']; label: string; icon: LucideIcon }[] = [
  { id: 'in_app', label: 'In-App', icon: Bell },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'slack', label: 'Slack', icon: MessageSquare },
  { id: 'discord', label: 'Discord', icon: Gamepad },
  { id: 'webhook', label: 'Webhook', icon: LinkIcon },
];

const EVENT_TYPES = [
  'fix_started', 'pr_created', 'fix_completed', 'review_needed',
  'rework_required', 'merge_completed', 'pipeline_failed', 'low_credits', 'payment_failed',
];

const API_KEYS = [
  { id: 'linear_key', label: 'Linear API Key', key: 'LINEAR_API_KEY', icon: GitBranch, required: true, placeholder: 'lin_api_...', docUrl: 'https://linear.app/settings/api' },
  { id: 'bitbucket_key', label: 'Bitbucket App Password', key: 'BITBUCKET_APP_PASSWORD', icon: LinkIcon, required: false, placeholder: 'Coming soon', docUrl: '', comingSoon: true },
  { id: 'jira_token', label: 'Jira API Token', key: 'JIRA_API_TOKEN', icon: LinkIcon, required: false, placeholder: 'Coming soon', docUrl: '', comingSoon: true },
];

const TABS = [
  { id: 'keys', label: 'API Keys', icon: Key },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Data & Privacy', icon: Shield },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Settings() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationPreference[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [dataPrivacyLoading, setDataPrivacyLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('keys');

  const [sysConfig, setSysConfig] = useState<any>({ env: {}, rateLimits: [], tokens: [], integrations: [], infrastructure: {}, symphonies: [], subscriptions: [], warnings: [] });
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [sysLoading, setSysLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    if (activeTab === 'notifications') loadNotifications();
    if (['env', 'rate-limits', 'tokens', 'integrations', 'infrastructure', 'keys'].includes(activeTab)) loadSysConfig(ac.signal);
    return () => ac.abort();
  }, [activeTab]);

  async function loadNotifications() {
    setNotificationsLoading(true);
    try { const prefs = await fetchPreferences(); setNotifications(prefs); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load notification preferences' }); }
    finally { setNotificationsLoading(false); }
  }

  async function handleToggleNotif(channel: NotificationPreference['channel'], eventType: string, enabled: boolean) {
    setMessage(null);
    try {
      await upsertPreference(channel, eventType, enabled, undefined);
      setNotifications((prev) => prev.map((n) => (n.channel === channel && n.eventType === eventType ? { ...n, enabled } : n)));
    } catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update preference' }); }
  }

  async function handleRequestDataDeletion() {
    if (!window.confirm('Are you sure you want to request data deletion? This action will be reviewed by support.')) return;
    setDataPrivacyLoading(true);
    try { await request('/v1/data/deletion-request', { method: 'POST' }); setMessage({ type: 'success', text: 'Deletion request submitted.' }); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit deletion request' }); }
    finally { setDataPrivacyLoading(false); }
  }

  async function loadSysConfig(signal?: AbortSignal) {
    setSysLoading(true);
    try {
      const data = await configApi.get({ signal });
      setSysConfig(data);
      setEnvValues(data.env || {});
      const initialKeys: Record<string, string> = {};
      API_KEYS.forEach((k) => { if (data.env?.[k.key]) initialKeys[k.id] = data.env[k.key]; });
      setApiKeyValues((prev) => ({ ...prev, ...initialKeys }));
    }
    catch (err) { if ((err as Error).name !== 'AbortError') setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load configuration' }); }
    finally { setSysLoading(false); }
  }

  async function handleSaveEnv() {
    setSaving(true); setMessage(null);
    try { await configApi.updateEnv(envValues); setMessage({ type: 'success', text: 'Environment variables updated.' }); setTimeout(() => setMessage(null), 3000); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' }); }
    finally { setSaving(false); }
  }

  async function handleSaveRateLimits() {
    setSaving(true); setMessage(null);
    try { await configApi.updateRateLimits(sysConfig.rateLimits); setMessage({ type: 'success', text: 'Rate limits updated.' }); setTimeout(() => setMessage(null), 3000); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' }); }
    finally { setSaving(false); }
  }

  async function handleRegenerateToken(tokenId: string) {
    if (!window.confirm('Regenerate this token? The old token will stop working immediately.')) return;
    try { await configApi.regenerateToken(tokenId); setMessage({ type: 'success', text: 'Token regenerated.' }); loadSysConfig(); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to regenerate token' }); }
  }

  async function handleRevokeToken(tokenId: string) {
    if (!window.confirm('Revoke this token? This cannot be undone.')) return;
    try { await configApi.revokeToken(tokenId); setMessage({ type: 'success', text: 'Token revoked.' }); loadSysConfig(); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke token' }); }
  }

  async function handleToggleIntegration(id: string) {
    try { await configApi.toggleIntegration(id, !sysConfig.integrations.find((i: any) => i.id === id)?.connected); setMessage({ type: 'success', text: 'Integration updated.' }); loadSysConfig(); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update integration' }); }
  }

  async function handleTestInfra(provider: string) {
    try { const result = await configApi.testInfrastructure(provider); setMessage({ type: 'success', text: `${provider}: ${result.status}` }); loadSysConfig(); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : `Failed to connect to ${provider}` }); }
  }

  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [apiKeySaving, setApiKeySaving] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});

  async function handleSaveApiKey(keyId: string) {
    setApiKeySaving((prev) => ({ ...prev, [keyId]: true }));
    setMessage(null);
    try {
      const apiKey = API_KEYS.find((k) => k.id === keyId)!;
      await configApi.updateEnv({ [apiKey.key]: apiKeyValues[keyId] || '' });
      setSysConfig((prev: any) => ({
        ...prev,
        env: { ...prev.env, [apiKey.key]: apiKeyValues[keyId] || '' },
      }));
      setEditMode((prev) => ({ ...prev, [keyId]: false }));
      setMessage({ type: 'success', text: 'API key saved.' });
      setTimeout(() => setMessage(null), 3000);
      if (apiKey.id === 'linear_key' && apiKeyValues[keyId]) {
        setVerifying((prev) => ({ ...prev, [keyId]: true }));
        try {
          const result = await configApi.verifyService('linear', apiKeyValues[keyId]);
          if (result.connected) {
            setSysConfig((prev: any) => ({
              ...prev,
              integrations: prev.integrations?.map((i: any) =>
                i.id === 'linear' ? { ...i, connected: true } : i
              ) || prev.integrations,
            }));
            setMessage({ type: 'success', text: 'Connected to Linear.' });
          } else {
            setMessage({ type: 'error', text: result.error || 'Failed to verify Linear API key' });
          }
        } catch {
          setMessage({ type: 'error', text: 'Could not verify Linear API key — connection test failed' });
        } finally {
          setVerifying((prev) => ({ ...prev, [keyId]: false }));
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save API key' });
    } finally {
      setApiKeySaving((prev) => ({ ...prev, [keyId]: false }));
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage API keys, notifications, and privacy settings</p>
      </div>

      {message && (
        <div className={`rounded-lg border p-4 text-sm ${
          message.type === 'error'
            ? 'border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/30 text-red-700 dark:text-red-300'
            : 'border-green-200 bg-green-50 dark:border-green-700 dark:bg-green-900/30 text-green-700 dark:text-green-300'
        }`}>
          {typeof message.text === 'string' ? message.text : 'An unexpected error occurred'}
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'keys' && <section>
        <div className="flex items-center gap-3 mb-4">
          <Key size={20} className="text-brand-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
            <p className="text-sm text-gray-500">Connect external services via API keys</p>
          </div>
        </div>

        {['github'].map((id) => {
          const int = sysConfig?.integrations?.find((i: any) => i.id === id);
          if (!int) return null;
          const labels: Record<string, { icon: any; desc: string }> = {
            github: { icon: GitPullRequest, desc: 'Connected via GitHub App' },
          };
          const meta = labels[id];
          const Icon = meta?.icon || LinkIcon;
          return (
            <div key={id} className="card mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon size={20} className="text-gray-500" />
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {int.name || id.charAt(0).toUpperCase() + id.slice(1)}
                    </h3>
                    <p className="text-xs text-gray-500">{meta?.desc}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                  int.connected
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${int.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                  {int.connected ? 'Connected' : 'Not Connected'}
                </span>
              </div>
            </div>
          );
        })}

        <div className="space-y-4">
          {API_KEYS.map((apiKey) => (
            <div key={apiKey.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <apiKey.icon size={20} className="text-gray-500" />
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{apiKey.label}</h3>
                    {apiKey.comingSoon && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Coming soon</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!apiKey.comingSoon && apiKey.docUrl && (
                    <a href={apiKey.docUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700">
                      How to get?
                    </a>
                  )}
                  {!apiKey.comingSoon && (
                    <>
                      {verifying[apiKey.id] ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          Connecting...
                        </span>
                      ) : (
                        <>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            sysConfig.env?.[apiKey.key]
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {sysConfig.env?.[apiKey.key] ? 'Saved' : 'New'}
                          </span>
                          {apiKey.id === 'linear_key' && (() => {
                            const li = sysConfig?.integrations?.find((i: any) => i.id === 'linear');
                            return li ? (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                li.connected
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${li.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                                {li.connected ? 'Connected' : 'Not Connected'}
                              </span>
                            ) : null;
                          })()}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {!apiKey.comingSoon && (
                <div className="mt-3">
                    {editMode[apiKey.id] ? (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="password"
                          value={apiKeyValues[apiKey.id] || ''}
                          onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [apiKey.id]: e.target.value }))}
                          placeholder={apiKey.placeholder}
                          className="input-field w-full font-mono text-sm min-h-[44px]"
                        />
                      </div>
                      <button
                        onClick={() => handleSaveApiKey(apiKey.id)}
                        disabled={apiKeySaving[apiKey.id]}
                        className="btn-primary min-h-[44px]"
                      >
                        {apiKeySaving[apiKey.id] ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditMode((prev) => ({ ...prev, [apiKey.id]: false }))}
                        className="btn-secondary min-h-[44px]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 border border-gray-200 dark:border-gray-700">
                      {sysConfig.env?.[apiKey.key] ? (
                        <span className="font-mono text-sm text-gray-400 select-all">
                          {(() => {
                            const v = sysConfig.env[apiKey.key];
                            return v.length > 8 ? v.slice(0, 8) + '••••••••' : '••••••••••••••••';
                          })()}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">Not configured</span>
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const kn = apiKey.key;
                            if (kn && sysConfig.env?.[kn] && !apiKeyValues[apiKey.id]) {
                              setApiKeyValues((prev) => ({ ...prev, [apiKey.id]: sysConfig.env[kn] }));
                            }
                            setEditMode((prev) => ({ ...prev, [apiKey.id]: true }));
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>}

      {activeTab === 'notifications' && <section>
        <div className="flex items-center gap-3 mb-4">
          <Bell size={20} className="text-brand-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h2>
            <p className="text-sm text-gray-500">Choose how and when you receive notifications</p>
          </div>
        </div>
        <div className="card">
          {notificationsLoading ? (
            <div className="space-y-4 animate-pulse">{[...Array(6)].map((_, i) => <div key={i} className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Email notifications enabled. Slack and Telegram coming soon.
              </p>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="py-3 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">Event</th>
                    {CHANNELS.map((ch) => (
                      <th key={ch.id} className="px-3 py-3 text-center font-medium text-gray-500 dark:text-gray-400">
                        <ch.icon size={16} className="inline-block mr-1" />
                        {ch.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EVENT_TYPES.map((event) => (
                    <tr key={event} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-3 pr-4 text-gray-900 dark:text-gray-100 font-medium capitalize">{event.replace(/_/g, ' ')}</td>
                      {CHANNELS.map((ch) => {
                        const pref = notifications.find((n) => n.channel === ch.id && n.eventType === event);
                        return (
                          <td key={ch.id} className="px-3 py-3 text-center">
                            <input type="checkbox" checked={pref?.enabled ?? false} onChange={(e) => handleToggleNotif(ch.id, event, e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>}

      {activeTab === 'privacy' && <section>
        <div className="flex items-center gap-3 mb-4">
          <Shield size={20} className="text-brand-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Data & Privacy</h2>
            <p className="text-sm text-gray-500">Manage your data and privacy settings</p>
          </div>
        </div>
        <div className="card">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Request Data Deletion</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Submit a request to delete all your personal data.</p>
              <button onClick={handleRequestDataDeletion} disabled={dataPrivacyLoading} className="btn-secondary mt-3 text-sm min-h-[44px]">
                {dataPrivacyLoading ? 'Submitting...' : 'Request Deletion'}
              </button>
            </div>
            <div className="rounded-lg border border-red-200 dark:border-red-800 p-4">
              <h3 className="text-sm font-medium text-red-700 dark:text-red-400">Reset Configuration to Defaults</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Reset all bot configuration, notification preferences, and settings.</p>
              <button className="btn-danger mt-3 text-sm min-h-[44px]">Reset All Settings</button>
            </div>
          </div>
        </div>
      </section>}
    </div>
  );
}
