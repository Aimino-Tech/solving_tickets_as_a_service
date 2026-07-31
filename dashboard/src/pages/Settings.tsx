import { useState, useEffect, useRef } from 'react';
import { request, configApi, github as githubApi } from '@/api/client';
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
  Eye,
  EyeOff,
  GitBranch,
  Key,
  Pencil,
  Play,
  CheckCircle,
  RefreshCw,
  GitMerge,
  AlertTriangle,
  CreditCard,
  XCircle,
  ChevronRight,
  Check,
  X,
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

const EVENT_ICONS: Record<string, LucideIcon> = {
  fix_started: Play,
  pr_created: GitPullRequest,
  fix_completed: CheckCircle,
  review_needed: Eye,
  rework_required: RefreshCw,
  merge_completed: GitMerge,
  pipeline_failed: AlertTriangle,
  low_credits: CreditCard,
  payment_failed: XCircle,
};

const API_KEYS = [
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
      if (data.env?.LINEAR_API_KEY) initialKeys['linear_key'] = data.env.LINEAR_API_KEY;
      setApiKeyValues((prev) => ({ ...prev, ...initialKeys }));
      const slackInt = data.integrations?.find((i: any) => i.id === 'slack');
      if (slackInt?.connected) setSlackConnected(true);
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
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
const [slackExpanded, setSlackExpanded] = useState(false);
const [linearExpanded, setLinearExpanded] = useState(false);
const [slackConnected, setSlackConnected] = useState(false);

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

        {(() => {
          const env = sysConfig.env || {};
          const li = sysConfig?.integrations?.find((i: any) => i.id === 'linear');
          const hasLinearKey = !!env.LINEAR_API_KEY;
          const linearConnected = li?.connected && hasLinearKey;
          return (
            <div className="card mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch size={20} className="text-gray-500" />
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Linear API Key</h3>
                    <p className="text-xs text-gray-500">
                      {hasLinearKey ? 'API key configured' : 'Not configured'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    verifying['linear_key']
                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      : linearConnected
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${verifying['linear_key'] ? 'bg-yellow-500' : linearConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {verifying['linear_key'] ? 'Connecting' : linearConnected ? 'Connected' : 'Not Set'}
                  </span>
                  <button
                    onClick={() => setLinearExpanded(!linearExpanded)}
                    className={`p-1.5 rounded-md transition-colors ${
                      linearExpanded
                        ? 'text-brand-600 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title={linearExpanded ? 'Collapse' : 'Edit'}
                  >
                    {linearExpanded ? <ChevronRight size={14} className="rotate-90" /> : <Pencil size={14} />}
                  </button>
                </div>
              </div>

              {linearExpanded && (
                <div className="mt-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`h-2 w-2 rounded-full ${hasLinearKey ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Linear API Key</span>
                      <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700 ml-auto">
                        How to get?
                      </a>
                    </div>
                    {editMode['linear_key'] ? (
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showApiKey['linear_key'] ? 'text' : 'password'}
                            value={apiKeyValues['linear_key'] || ''}
                            onChange={(e) => setApiKeyValues(prev => ({ ...prev, linear_key: e.target.value }))}
                            placeholder="lin_api_..."
                            className="input-field w-full font-mono text-sm min-h-[36px] pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((prev) => ({ ...prev, linear_key: !prev['linear_key'] }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            tabIndex={-1}
                          >
                            {showApiKey['linear_key'] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        <button
                          onClick={async () => {
                            setApiKeySaving(prev => ({ ...prev, linear_key: true }));
                            setMessage(null);
                            try {
                              await configApi.updateEnv({ 'LINEAR_API_KEY': apiKeyValues['linear_key'] || '' });
                              setSysConfig((prev: any) => ({
                                ...prev,
                                env: { ...prev.env, LINEAR_API_KEY: apiKeyValues['linear_key'] || '' },
                              }));
                              setEditMode(prev => ({ ...prev, linear_key: false }));
                              setMessage({ type: 'success', text: 'Linear API key saved.' });
                              setTimeout(() => setMessage(null), 3000);
                              if (apiKeyValues['linear_key']) {
                                setVerifying(prev => ({ ...prev, linear_key: true }));
                                try {
                                  const result = await configApi.verifyService('linear', apiKeyValues['linear_key']);
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
                                  setVerifying(prev => ({ ...prev, linear_key: false }));
                                }
                              }
                            } catch (err) {
                              setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
                            } finally {
                              setApiKeySaving(prev => ({ ...prev, linear_key: false }));
                            }
                          }}
                          disabled={apiKeySaving['linear_key']}
                          className="btn-primary text-xs min-h-[36px] px-3"
                        >
                          {apiKeySaving['linear_key'] ? '...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditMode(prev => ({ ...prev, linear_key: false }))}
                          className="btn-secondary text-xs min-h-[36px] px-3"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2 border border-gray-200 dark:border-gray-700">
                        {hasLinearKey ? (
                          <span className="font-mono text-sm text-gray-400 select-all">
                            {(() => {
                              const v = env.LINEAR_API_KEY;
                              return v.length > 8 ? v.slice(0, 8) + '••••••••' : '••••••••••••••••';
                            })()}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Not configured</span>
                        )}
                        <button
                          onClick={() => {
                            if (env.LINEAR_API_KEY && !apiKeyValues['linear_key']) {
                              setApiKeyValues(prev => ({ ...prev, linear_key: env.LINEAR_API_KEY }));
                            }
                            setEditMode(prev => ({ ...prev, linear_key: true }));
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {li && (
                    <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                      <span className="text-xs text-gray-500">Integration status</span>
                      <div className="flex items-center gap-2">
                        {verifying['linear_key'] ? (
                          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                            Connecting...
                          </span>
                        ) : (
                          <>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                              linearConnected
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${linearConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
                              {linearConnected ? 'Connected' : 'Not Connected'}
                            </span>
                            {hasLinearKey && (
                              <button
                                onClick={async () => {
                                  setMessage(null);
                                  try {
                                    setVerifying(prev => ({ ...prev, linear_key: true }));
                                    const result = await configApi.verifyService('linear', env.LINEAR_API_KEY);
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
                                    setVerifying(prev => ({ ...prev, linear_key: false }));
                                  }
                                }}
                                className="btn-secondary text-xs min-h-[36px] px-3"
                              >
                                Test Connection
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

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
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    int.connected
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${int.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {int.connected ? 'Connected' : 'Not Connected'}
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        const { url } = await githubApi.getOAuthUrl();
                        window.location.href = url;
                      } catch {
                        setMessage({ type: 'error', text: 'Could not generate GitHub reconnection URL' });
                      }
                    }}
                    className="p-1.5 rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Reconnect GitHub"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {(() => {
          const env = sysConfig.env || {};
          const slackFields = [
            { id: 'slack_bot_token', key: 'SLACK_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...', docUrl: 'https://api.slack.com/authentication/token-types#bot' },
            { id: 'slack_app_token', key: 'SLACK_APP_TOKEN', label: 'App Token', placeholder: 'xapp-...', docUrl: 'https://api.slack.com/authentication/token-types#app' },
          ];
          const configuredCount = slackFields.filter(f => !!env[f.key]).length;
          const allConfigured = configuredCount === slackFields.length;
          return (
            <div className="card mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-gray-500" />
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Slack API Key</h3>
                    <p className="text-xs text-gray-500">
                      {configuredCount === 0 ? 'Not configured' : `${configuredCount}/${slackFields.length} fields configured`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    slackConnected
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : verifying['slack_bot_token']
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${slackConnected ? 'bg-green-500' : verifying['slack_bot_token'] ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                    {slackConnected ? 'Connected' : verifying['slack_bot_token'] ? 'Connecting' : 'Not Set'}
                  </span>
                  <button
                    onClick={() => setSlackExpanded(!slackExpanded)}
                    className={`p-1.5 rounded-md transition-colors ${
                      slackExpanded
                        ? 'text-brand-600 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title={slackExpanded ? 'Collapse' : 'Edit'}
                  >
                    {slackExpanded ? <ChevronRight size={14} className="rotate-90" /> : <Pencil size={14} />}
                  </button>
                </div>
              </div>

              {slackExpanded && (
                <div className="mt-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                  {slackFields.map(field => {
                    const isEditing = editMode[field.id];
                    const val = apiKeyValues[field.id] !== undefined ? apiKeyValues[field.id] : '';
                    return (
                      <div key={field.id}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`h-2 w-2 rounded-full ${!!env[field.key] ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{field.label}</span>
                          {field.docUrl && (
                            <a href={field.docUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700 ml-auto">
                              How to get?
                            </a>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={val}
                              onChange={(e) => setApiKeyValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                              placeholder={field.placeholder}
                              className="input-field flex-1 font-mono text-sm min-h-[36px]"
                            />
                            <button
                              onClick={async () => {
                                setApiKeySaving(prev => ({ ...prev, [field.id]: true }));
                                setMessage(null);
                                try {
                                  await configApi.updateEnv({ [field.key]: val || '' });
                                  setSysConfig((prev: any) => ({
                                    ...prev,
                                    env: { ...prev.env, [field.key]: val || '' },
                                  }));
                                  setEditMode(prev => ({ ...prev, [field.id]: false }));
                                  setMessage({ type: 'success', text: `${field.label} saved.` });
                                  setTimeout(() => setMessage(null), 3000);
                                  if (field.id === 'slack_bot_token' && val) {
                                    setVerifying(prev => ({ ...prev, [field.id]: true }));
                                    try {
                                      const result = await configApi.verifyService('slack', val);
                                      if (result.connected) setSlackConnected(true);
                                      setMessage({ type: result.connected ? 'success' : 'error', text: result.connected ? 'Slack connection verified!' : result.error || 'Verification failed' });
                                    } catch {
                                      setMessage({ type: 'error', text: 'Could not verify Slack connection' });
                                    } finally {
                                      setVerifying(prev => ({ ...prev, [field.id]: false }));
                                    }
                                  }
                                } catch (err) {
                                  setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
                                } finally {
                                  setApiKeySaving(prev => ({ ...prev, [field.id]: false }));
                                }
                              }}
                              disabled={apiKeySaving[field.id]}
                              className="btn-primary text-xs min-h-[36px] px-3"
                            >
                              {apiKeySaving[field.id] ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditMode(prev => ({ ...prev, [field.id]: false }))}
                              className="btn-secondary text-xs min-h-[36px] px-3"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2 border border-gray-200 dark:border-gray-700">
                            {env[field.key] ? (
                              <span className="font-mono text-sm text-gray-400 select-all">
                                {(() => {
                                  const v = env[field.key];
                                  return v.length > 8 ? v.slice(0, 8) + '••••••••' : '••••••••••••••••';
                                })()}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">Not configured</span>
                            )}
                            <button
                              onClick={() => {
                                if (field.key && env[field.key] && !apiKeyValues[field.id]) {
                                  setApiKeyValues(prev => ({ ...prev, [field.id]: env[field.key] }));
                                }
                                setEditMode(prev => ({ ...prev, [field.id]: true }));
                              }}
                              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {allConfigured && (
                    <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
                      {verifying['slack_bot_token'] ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          Connecting...
                        </span>
                      ) : (
                        <button
                          onClick={async () => {
                            setMessage(null);
                            setVerifying(prev => ({ ...prev, slack_bot_token: true }));
                            try {
                              const result = await configApi.verifyService('slack', env.SLACK_BOT_TOKEN);
                              if (result.connected) setSlackConnected(true);
                              setMessage({ type: result.connected ? 'success' : 'error', text: result.connected ? 'Slack connection verified!' : result.error || 'Verification failed' });
                            } catch (err) {
                              setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not verify Slack connection' });
                            } finally {
                              setVerifying(prev => ({ ...prev, slack_bot_token: false }));
                            }
                          }}
                          className="btn-secondary text-xs min-h-[36px] px-3"
                        >
                          Test Connection
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

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
                          type={showApiKey[apiKey.id] ? 'text' : 'password'}
                          value={apiKeyValues[apiKey.id] || ''}
                          onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [apiKey.id]: e.target.value }))}
                          placeholder={apiKey.placeholder}
                          className="input-field w-full font-mono text-sm min-h-[44px] pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((prev) => ({ ...prev, [apiKey.id]: !prev[apiKey.id] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                          tabIndex={-1}
                        >
                          {showApiKey[apiKey.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
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
        {notificationsLoading ? (
          <div className="space-y-3 animate-pulse">{[...Array(6)].map((_, i) => <div key={i} className="h-14 w-full rounded-lg bg-gray-200 dark:bg-gray-700" />)}</div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="py-3 px-5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Configure Slack in the API Keys tab. Telegram notifications coming soon.
              </p>
            </div>
            {EVENT_TYPES.map((event) => {
              const EventIcon = EVENT_ICONS[event] || Bell;
              return (
                <div
                  key={event}
                  className="py-3 px-5 border-b border-gray-100 dark:border-gray-800 last:border-b-0 flex items-center justify-between gap-4 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="text-gray-400 dark:text-gray-500 flex-shrink-0 flex items-center justify-center">
                      <EventIcon size={18} />
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize truncate">
                      {event.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {CHANNELS.map((ch) => {
                      const pref = notifications.find((n) => n.channel === ch.id && n.eventType === event);
                      const enabled = pref?.enabled ?? false;
                      return (
                        <button
                          key={ch.id}
                          onClick={() => handleToggleNotif(ch.id, event, !enabled)}
                          className={`inline-flex items-center gap-1 rounded-full border py-1 px-2 text-xs font-medium transition-colors ${
                            enabled
                              ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300 dark:border-brand-600 hover:bg-brand-100 dark:hover:bg-brand-900/30'
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                          title={`${ch.label}: ${enabled ? 'Enabled' : 'Disabled'}`}
                        >
                          {enabled ? (
                            <span className="rounded-full bg-brand p-0.5">
                              <Check size={10} className="text-white" />
                            </span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-600">
                              <X size={10} />
                            </span>
                          )}
                          <span className="hidden sm:inline">{ch.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 flex-shrink-0" />
                </div>
              );
            })}
          </div>
        )}
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
