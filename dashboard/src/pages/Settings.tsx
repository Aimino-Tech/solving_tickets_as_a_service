import { useState, useEffect, useRef } from 'react';
import { request, configApi, github as githubApi, mcpKeysApi } from '@/api/client';
import type { McpApiKey } from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import {
  MessageSquare,
  Link as LinkIcon,
  Shield,
  GitPullRequest,
  Eye,
  EyeOff,
  GitBranch,
  Key,
  Pencil,
  ChevronRight,
  Bot,
  Plus,
  Copy,
  Trash2,
} from 'lucide-react';

const API_KEYS = [
  { id: 'bitbucket_key', label: 'Bitbucket App Password', key: 'BITBUCKET_APP_PASSWORD', icon: LinkIcon, required: false, placeholder: 'Coming soon', docUrl: '', comingSoon: true },
  { id: 'jira_token', label: 'Jira API Token', key: 'JIRA_API_TOKEN', icon: LinkIcon, required: false, placeholder: 'Coming soon', docUrl: '', comingSoon: true },
];

const TABS = [
  { id: 'keys', label: 'API Keys', icon: Key },
  { id: 'privacy', label: 'Data & Privacy', icon: Shield },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Settings() {
  const { user } = useAuth();
  const [dataPrivacyLoading, setDataPrivacyLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('keys');

  const [sysConfig, setSysConfig] = useState<any>({ env: {}, rateLimits: [], tokens: [], integrations: [], infrastructure: {}, symphonies: [], subscriptions: [], warnings: [] });
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [sysLoading, setSysLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    if (['env', 'rate-limits', 'tokens', 'integrations', 'infrastructure', 'keys'].includes(activeTab)) loadSysConfig(ac.signal);
    return () => ac.abort();
  }, [activeTab]);

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
const [mcpKeys, setMcpKeys] = useState<McpApiKey[]>([]);
const [mcpKeysLoading, setMcpKeysLoading] = useState(false);
const [showCreateKey, setShowCreateKey] = useState(false);
const [newKeyName, setNewKeyName] = useState('');
const [creatingKey, setCreatingKey] = useState(false);
const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ key: string; name: string } | null>(null);
const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
const [editingKeyName, setEditingKeyName] = useState('');
const [keyActionId, setKeyActionId] = useState<string | null>(null);

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

  async function loadMcpKeys() {
    setMcpKeysLoading(true);
    try {
      const data = await mcpKeysApi.list();
      setMcpKeys(data.keys || []);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load MCP API keys' });
    } finally {
      setMcpKeysLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'keys') loadMcpKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function handleCreateMcpKey() {
    const name = newKeyName.trim();
    if (!name) { setMessage({ type: 'error', text: 'Please enter a key name' }); return; }
    setCreatingKey(true);
    setMessage(null);
    try {
      const result = await mcpKeysApi.create(name);
      setNewlyCreatedKey({ key: result.key, name: result.name });
      setNewKeyName('');
      setShowCreateKey(false);
      await loadMcpKeys();
      setMessage({ type: 'success', text: 'MCP API key created. Copy it now — it will not be shown again.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create MCP API key' });
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleRevokeMcpKey(keyId: string, keyName: string) {
    if (!window.confirm(`Revoke MCP API key "${keyName}"? Agents using it will lose access immediately.`)) return;
    setKeyActionId(keyId);
    setMessage(null);
    try {
      await mcpKeysApi.revoke(keyId);
      setMcpKeys((prev) => prev.filter((k) => k.id !== keyId));
      setMessage({ type: 'success', text: 'MCP API key revoked.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to revoke key' });
    } finally {
      setKeyActionId(null);
    }
  }

  async function handleRenameMcpKey(keyId: string) {
    const name = editingKeyName.trim();
    if (!name) return;
    setKeyActionId(keyId);
    setMessage(null);
    try {
      const updated = await mcpKeysApi.rename(keyId, name);
      setMcpKeys((prev) => prev.map((k) => (k.id === keyId ? updated : k)));
      setEditingKeyId(null);
      setMessage({ type: 'success', text: 'Key renamed.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to rename key' });
    } finally {
      setKeyActionId(null);
    }
  }

  async function handleCopyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setMessage({ type: 'success', text: 'Key copied to clipboard.' });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: 'error', text: 'Could not copy key automatically — please copy it manually.' });
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage API keys and privacy settings</p>
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

        <div className="card mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot size={20} className="text-gray-500" />
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">MCP API Keys</h3>
                <p className="text-xs text-gray-500">
                  Keys for AI agents to connect to STAS via MCP (set as STAS_API_KEY in your agent)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {mcpKeys.length} active
              </span>
              <button
                onClick={() => setShowCreateKey((prev) => !prev)}
                className="btn-primary text-xs min-h-[32px] px-3"
              >
                <Plus size={14} className="inline mr-1" />
                Create key
              </button>
            </div>
          </div>

          {showCreateKey && (
            <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g. my-agent, claude-desktop)"
                  className="input-field flex-1 font-mono text-sm min-h-[36px]"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateMcpKey(); }}
                />
                <button onClick={handleCreateMcpKey} disabled={creatingKey} className="btn-primary text-xs min-h-[36px] px-3">
                  {creatingKey ? '...' : 'Create'}
                </button>
                <button onClick={() => setShowCreateKey(false)} className="btn-secondary text-xs min-h-[36px] px-3">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {newlyCreatedKey && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-700 dark:bg-green-900/30 p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Key "{newlyCreatedKey.name}" created — copy it now, it will not be shown again.
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                  Use it as <code className="font-mono">STAS_API_KEY</code> when configuring your agent (Claude Desktop, Cursor, OpenCode...).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-white dark:bg-gray-900 border border-green-300 dark:border-green-700 px-3 py-2 font-mono text-sm break-all select-all">
                  {newlyCreatedKey.key}
                </code>
                <button onClick={() => handleCopyKey(newlyCreatedKey.key)} className="btn-secondary text-xs min-h-[36px] px-3">
                  <Copy size={14} className="inline mr-1" />
                  Copy
                </button>
                <button onClick={() => setNewlyCreatedKey(null)} className="btn-secondary text-xs min-h-[36px] px-3">
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {mcpKeysLoading ? (
              <p className="text-sm text-gray-400">Loading keys...</p>
            ) : mcpKeys.length === 0 ? (
              <p className="text-sm text-gray-400">No MCP API keys yet. Create one to let your agents connect.</p>
            ) : (
              mcpKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 border border-gray-200 dark:border-gray-700">
                  {editingKeyId === k.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        value={editingKeyName}
                        onChange={(e) => setEditingKeyName(e.target.value)}
                        className="input-field flex-1 font-mono text-sm min-h-[32px]"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRenameMcpKey(k.id); if (e.key === 'Escape') setEditingKeyId(null); }}
                      />
                      <button onClick={() => handleRenameMcpKey(k.id)} disabled={keyActionId === k.id} className="btn-primary text-xs min-h-[32px] px-3">
                        {keyActionId === k.id ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingKeyId(null)} className="btn-secondary text-xs min-h-[32px] px-3">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{k.name}</span>
                          <button
                            onClick={() => { setEditingKeyId(k.id); setEditingKeyName(k.name); }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title="Rename"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="font-mono text-xs text-gray-400 select-all">{k.keyPrefix}••••••••</code>
                          <span className="text-xs text-gray-400">
                            Created {new Date(k.createdAt).toLocaleDateString()}
                            {k.lastUsedAt ? ` · Used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeMcpKey(k.id, k.name)}
                        disabled={keyActionId === k.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Revoke key"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
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
