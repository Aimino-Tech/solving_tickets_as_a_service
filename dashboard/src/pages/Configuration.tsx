import { useState, useEffect, useRef } from 'react';
import { configApi } from '@/api/client';

type EnvVar = {
  key: string;
  value: string;
  masked: boolean;
  required: boolean;
  description: string;
};

type RateLimit = {
  endpoint: string;
  limit: number;
  window: string;
};

type Token = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsed: string | null;
};

type SymphonyConnection = {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  endpoint: string;
  lastSync: string | null;
};

type ManagerSubscription = {
  id: string;
  event: string;
  channel: string;
  target: string;
  enabled: boolean;
};

type Warning = {
  id: string;
  type: 'rate_limit' | 'quota' | 'token_expiry' | 'system';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  dismissed: boolean;
  createdAt: string;
};

type Integration = {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  configUrl?: string;
};

type InfrastructureConfig = {
  provider: string;
  host: string;
  port: number;
  status: 'connected' | 'disconnected' | 'error';
};

type SystemConfig = {
  env: Record<string, string>;
  rateLimits: RateLimit[];
  tokens: Token[];
  symphonies: SymphonyConnection[];
  subscriptions: ManagerSubscription[];
  warnings: Warning[];
  integrations: Integration[];
  infrastructure: Record<string, InfrastructureConfig>;
};

const INITIAL_CONFIG: SystemConfig = {
  env: {},
  rateLimits: [],
  tokens: [],
  symphonies: [],
  subscriptions: [],
  warnings: [],
  integrations: [
    { id: 'slack', name: 'Slack', icon: '💬', connected: false },
    { id: 'discord', name: 'Discord', icon: '🎮', connected: false },
    { id: 'jira', name: 'Jira', icon: '📋', connected: false },
    { id: 'linear', name: 'Linear', icon: '📐', connected: false },
    { id: 'pagerduty', name: 'PagerDuty', icon: '🚨', connected: false },
    { id: 'datadog', name: 'Datadog', icon: '📊', connected: false },
  ],
  infrastructure: {
    redis: { provider: 'Redis', host: 'localhost', port: 6379, status: 'disconnected' },
    rabbitmq: { provider: 'RabbitMQ', host: 'localhost', port: 5672, status: 'disconnected' },
    postgres: { provider: 'PostgreSQL', host: 'localhost', port: 5432, status: 'disconnected' },
  },
};

const ENV_VARS: EnvVar[] = [
  { key: 'GITHUB_APP_ID', value: '', masked: false, required: true, description: 'GitHub App ID from your GitHub App settings' },
  { key: 'GITHUB_APP_PRIVATE_KEY', value: '', masked: true, required: true, description: 'Private key PEM of your GitHub App' },
  { key: 'GITHUB_WEBHOOK_SECRET', value: '', masked: true, required: true, description: 'Webhook secret for verifying GitHub payloads' },
  { key: 'REDIS_URL', value: '', masked: true, required: false, description: 'Redis connection string (optional, defaults to localhost:6379)' },
  { key: 'RABBITMQ_URL', value: '', masked: true, required: false, description: 'RabbitMQ connection string (optional)' },
  { key: 'DATABASE_URL', value: '', masked: true, required: false, description: 'PostgreSQL connection string (optional)' },
  { key: 'OPENSEARCH_API_KEY', value: '', masked: true, required: false, description: 'OpenCode API key for agent orchestration' },
  { key: 'SENTRY_DSN', value: '', masked: true, required: false, description: 'Sentry DSN for error tracking (optional)' },
];

export default function Configuration() {
  const [config, setConfig] = useState<SystemConfig>(INITIAL_CONFIG);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('env');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const data = await configApi.get();
      setConfig(data);
      setEnvValues(data.env || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEnv() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await configApi.updateEnv(envValues);
      setSuccess('Environment variables updated successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRateLimits() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await configApi.updateRateLimits(config.rateLimits);
      setSuccess('Rate limits updated successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateToken(tokenId: string) {
    if (!window.confirm('Regenerate this token? The old token will stop working immediately.')) return;
    try {
      await configApi.regenerateToken(tokenId);
      setSuccess('Token regenerated.');
      loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate token');
    }
  }

  async function handleRevokeToken(tokenId: string) {
    if (!window.confirm('Revoke this token? This cannot be undone.')) return;
    try {
      await configApi.revokeToken(tokenId);
      setSuccess('Token revoked.');
      loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    }
  }

  async function handleToggleIntegration(id: string) {
    try {
      await configApi.toggleIntegration(id, !config.integrations.find(i => i.id === id)?.connected);
      setSuccess('Integration updated.');
      loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update integration');
    }
  }

  async function handleTestInfra(provider: string) {
    try {
      const result = await configApi.testInfrastructure(provider);
      setSuccess(`${provider}: ${result.status}`);
      loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to connect to ${provider}`);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-4 space-y-3">
              <div className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 w-full rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">System Configuration</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage environment variables, rate limits, tokens, integrations, and infrastructure connections.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/30 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-700 dark:bg-green-900/30 p-4">
          <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        {[
          { id: 'env', label: 'Environment', icon: '🔐' },
          { id: 'rate-limits', label: 'Rate Limits', icon: '🚦' },
          { id: 'tokens', label: 'Tokens', icon: '🔑' },
          { id: 'symphony', label: 'Symphony', icon: '🎼' },
          { id: 'subscriptions', label: 'Subscriptions', icon: '📡' },
          { id: 'warnings', label: 'Warnings', icon: '⚠️' },
          { id: 'integrations', label: 'Integrations', icon: '🔌' },
          { id: 'infrastructure', label: 'Infrastructure', icon: '🖥️' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
              activeTab === tab.id
                ? 'bg-brand-50 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Environment Variables */}
      {activeTab === 'env' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Environment Variables</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Core application configuration. Changes require a restart.
          </p>
          <div className="mt-6 space-y-5">
            {ENV_VARS.map((envVar) => (
              <div key={envVar.key}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {envVar.key}
                  {envVar.required && <span className="ml-1 text-red-500">*</span>}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{envVar.description}</p>
                <div className="flex gap-2">
                  <input
                    type={envVar.masked && !showSecrets[envVar.key] ? 'password' : 'text'}
                    value={envValues[envVar.key] || ''}
                    onChange={(e) => setEnvValues({ ...envValues, [envVar.key]: e.target.value })}
                    placeholder={envVar.required ? 'Required' : 'Optional'}
                    className="input-field mt-1 w-full max-w-lg font-mono text-sm min-h-[44px]"
                  />
                  {envVar.masked && (
                    <button
                      onClick={() => setShowSecrets({ ...showSecrets, [envVar.key]: !showSecrets[envVar.key] })}
                      className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[44px]"
                    >
                      {showSecrets[envVar.key] ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button onClick={handleSaveEnv} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save Environment'}
              </button>
              <button onClick={loadConfig} className="btn-secondary">
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rate Limits */}
      {activeTab === 'rate-limits' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Rate Limits</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure API rate limits per endpoint to prevent abuse.
          </p>
          <div className="mt-6 space-y-4">
            {config.rateLimits.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No rate limits configured. Add one below.</p>
            ) : (
              config.rateLimits.map((rl, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Endpoint</label>
                    <input
                      type="text"
                      value={rl.endpoint}
                      onChange={(e) => {
                        const updated = [...config.rateLimits];
                        updated[i] = { ...updated[i], endpoint: e.target.value };
                        setConfig({ ...config, rateLimits: updated });
                      }}
                      className="input-field mt-1 w-full text-sm min-h-[44px]"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Limit</label>
                    <input
                      type="number"
                      value={rl.limit}
                      onChange={(e) => {
                        const updated = [...config.rateLimits];
                        updated[i] = { ...updated[i], limit: Number(e.target.value) };
                        setConfig({ ...config, rateLimits: updated });
                      }}
                      className="input-field mt-1 w-full text-sm min-h-[44px]"
                    />
                  </div>
                  <div className="w-32">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Window</label>
                    <select
                      value={rl.window}
                      onChange={(e) => {
                        const updated = [...config.rateLimits];
                        updated[i] = { ...updated[i], window: e.target.value };
                        setConfig({ ...config, rateLimits: updated });
                      }}
                      className="input-field mt-1 w-full text-sm min-h-[44px]"
                    >
                      <option value="1m">1 minute</option>
                      <option value="5m">5 minutes</option>
                      <option value="15m">15 minutes</option>
                      <option value="1h">1 hour</option>
                      <option value="1d">1 day</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const updated = config.rateLimits.filter((_, j) => j !== i);
                      setConfig({ ...config, rateLimits: updated });
                    }}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
            <button
              onClick={() => setConfig({
                ...config,
                rateLimits: [...config.rateLimits, { endpoint: '/api/', limit: 100, window: '1m' }],
              })}
              className="btn-secondary text-sm"
            >
              + Add Rate Limit
            </button>
            <div className="flex gap-3 pt-2">
              <button onClick={handleSaveRateLimits} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save Rate Limits'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tokens */}
      {activeTab === 'tokens' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">API Tokens</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage authentication tokens for API access.
          </p>
          <div className="mt-6 space-y-4">
            {config.tokens.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No tokens created yet.</p>
            ) : (
              config.tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{token.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Scopes: {token.scopes.join(', ')} &middot;
                      Created: {new Date(token.createdAt).toLocaleDateString()}
                      {token.lastUsed && ` · Last used: ${new Date(token.lastUsed).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleRegenerateToken(token.id)} className="btn-secondary text-xs min-h-[44px]">
                      Regenerate
                    </button>
                    <button onClick={() => handleRevokeToken(token.id)} className="btn-danger text-xs min-h-[44px]">
                      Revoke
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Symphony Connections */}
      {activeTab === 'symphony' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Symphony Connections</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage Symphony agent mesh connections for distributed fix execution.
          </p>
          <div className="mt-6 space-y-4">
            {config.symphonies.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No Symphony connections configured.</p>
            ) : (
              config.symphonies.map((sym) => (
                <div key={sym.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{sym.name}</p>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        sym.status === 'connected' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        sym.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {sym.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {sym.endpoint} {sym.lastSync && `· Last sync: ${new Date(sym.lastSync).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs min-h-[44px]">Edit</button>
                    <button className="btn-danger text-xs min-h-[44px]">Disconnect</button>
                  </div>
                </div>
              ))
            )}
            <button className="btn-primary text-sm">+ Connect Symphony</button>
          </div>
        </div>
      )}

      {/* Manager Subscriptions */}
      {activeTab === 'subscriptions' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Manager Subscriptions</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Subscribe to system events and route them to notification channels.
          </p>
          <div className="mt-6 space-y-3">
            {config.subscriptions.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No subscriptions configured.</p>
            ) : (
              config.subscriptions.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{sub.event}</p>
                      <span className="text-xs text-gray-400">→ {sub.channel}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Target: {sub.target}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={sub.enabled}
                      onChange={() => {
                        const updated = config.subscriptions.map(s =>
                          s.id === sub.id ? { ...s, enabled: !s.enabled } : s
                        );
                        setConfig({ ...config, subscriptions: updated });
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <button className="text-red-500 hover:text-red-700 text-xs font-medium min-h-[44px]">Remove</button>
                  </div>
                </div>
              ))
            )}
            <button className="btn-primary text-sm">+ Add Subscription</button>
          </div>
        </div>
      )}

      {/* Warnings */}
      {activeTab === 'warnings' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">System Warnings</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Active warnings and alerts for your STAS instance.
          </p>
          <div className="mt-6 space-y-3">
            {config.warnings.length === 0 ? (
              <div className="rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/30 p-6 text-center">
                <p className="text-sm text-green-700 dark:text-green-300 font-medium">All systems operational — no active warnings.</p>
              </div>
            ) : (
              config.warnings.map((w) => (
                <div key={w.id} className={`rounded-lg border p-4 ${
                  w.severity === 'critical'
                    ? 'border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30'
                    : w.severity === 'warning'
                    ? 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30'
                    : 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <span className="text-lg mt-0.5">
                        {w.severity === 'critical' ? '🔴' : w.severity === 'warning' ? '🟡' : '🔵'}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{w.message}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {w.type.replace(/_/g, ' ')} · {new Date(w.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <button className="text-xs text-gray-400 hover:text-gray-600 min-h-[44px]">Dismiss</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Apps & Integrations */}
      {activeTab === 'integrations' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Apps & Integrations</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Connect third-party services to extend STAS capabilities.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {config.integrations.map((integration) => (
              <div
                key={integration.id}
                className={`rounded-lg border p-4 transition-colors ${
                  integration.connected
                    ? 'border-green-200 dark:border-green-700 bg-green-50/50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-brand-200 dark:hover:border-brand-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{integration.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{integration.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {integration.connected ? 'Connected' : 'Not connected'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleToggleIntegration(integration.id)}
                    className={`flex-1 rounded-lg py-2 text-xs font-medium min-h-[44px] transition-colors ${
                      integration.connected
                        ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-400'
                    }`}
                  >
                    {integration.connected ? 'Disconnect' : 'Connect'}
                  </button>
                  {integration.configUrl && (
                    <button className="btn-secondary text-xs min-h-[44px]">Configure</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Infrastructure */}
      {activeTab === 'infrastructure' && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Infrastructure</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor and manage backend service connections.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {Object.entries(config.infrastructure).map(([key, infra]) => (
              <div key={key} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{infra.provider}</h4>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    infra.status === 'connected' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    infra.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {infra.status}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p>Host: {infra.host}</p>
                  <p>Port: {infra.port}</p>
                </div>
                <button
                  onClick={() => handleTestInfra(key)}
                  className="mt-4 w-full rounded-lg border border-gray-200 dark:border-gray-600 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-h-[44px]"
                >
                  Test Connection
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
