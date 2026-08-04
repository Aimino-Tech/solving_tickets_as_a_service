import { useState, useEffect } from 'react';
import { request, configApi, github as githubApi, mcpKeysApi } from '@/api/client';
import type { McpApiKey } from '@/api/types';
import {
  MessageSquare,
  Link as LinkIcon,
  GitPullRequest,
  Eye,
  EyeOff,
  GitBranch,
  Pencil,
  Plus,
  Copy,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';

function JsonCode({ json }: { json: string }) {
  const lines = json.split('\n').map((line, i) => {
    const tokens: { text: string; cls: string }[] = [];
    const re = /("(?:[^"\\]|\\.)*"|[{}\[\],:]|\btrue\b|\bfalse\b|\bnull\b)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) tokens.push({ text: line.slice(last, m.index), cls: 'text-gray-500 dark:text-gray-400' });
      const t = m[0];
      if (t === ':' || t === ',' || t === '{' || t === '}' || t === '[' || t === ']') {
        tokens.push({ text: t, cls: 'text-gray-400' });
      } else if (t === 'true' || t === 'false' || t === 'null') {
        tokens.push({ text: t, cls: 'text-purple-600 dark:text-purple-400' });
      } else if (t.startsWith('"') && t.endsWith('"')) {
        const isKey = /^"[\w\s]+"\s*:/.test(line.slice(m.index));
        tokens.push({ text: t, cls: isKey ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400' });
      } else {
        tokens.push({ text: t, cls: 'text-gray-500 dark:text-gray-400' });
      }
      last = m.index + t.length;
    }
    if (last < line.length) tokens.push({ text: line.slice(last), cls: 'text-gray-500 dark:text-gray-400' });
    return (
      <span key={i} className="block">
        {tokens.map((t, j) => (
          <span key={j} className={t.cls}>{t.text}</span>
        ))}
      </span>
    );
  });
  return <code className="font-mono text-xs leading-relaxed whitespace-pre">{lines}</code>;
}

export default function Settings() {
  const [dataPrivacyLoading, setDataPrivacyLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [sysConfig, setSysConfig] = useState<any>({ env: {}, rateLimits: [], tokens: [], integrations: [], infrastructure: {}, symphonies: [], subscriptions: [], warnings: [] });
  const [mcpApiUrl, setMcpApiUrl] = useState('https://api.syntaro.io');
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    loadSysConfig(ac.signal);
    return () => ac.abort();
  }, []);

  async function handleRequestDataDeletion() {
    if (!window.confirm('Are you sure you want to request data deletion? This action will be reviewed by support.')) return;
    setDataPrivacyLoading(true);
    try { await request('/v1/data/deletion-request', { method: 'POST' }); setMessage({ type: 'success', text: 'Deletion request submitted.' }); }
    catch (err) { setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit deletion request' }); }
    finally { setDataPrivacyLoading(false); }
  }

  async function loadSysConfig(signal?: AbortSignal) {
    try {
      const data = await configApi.get({ signal });
      setSysConfig(data);
      if (data.mcp?.apiUrl) setMcpApiUrl(data.mcp.apiUrl);
      else if (data.publicUrl) setMcpApiUrl(data.publicUrl);
      if (data.env?.LINEAR_API_KEY) setApiKeyValues((prev) => ({ ...prev, linear_key: data.env?.LINEAR_API_KEY }));
      const slackInt = data.integrations?.find((i: any) => i.id === 'slack');
      if (slackInt?.connected) setSlackConnected(true);
    }
    catch (err) { if ((err as Error).name !== 'AbortError') setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load configuration' }); }
    finally { }
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
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [lastRevealedKey, setLastRevealedKey] = useState<string | null>(null);
  const [guideKeyId, setGuideKeyId] = useState<string | null>(null);

  const guideJsonKey = (guideKeyId && revealedKeys[guideKeyId]) || Object.values(revealedKeys)[0] || '';

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
    loadMcpKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showSetupGuide || lastRevealedKey) return;
    const revealable = mcpKeys.find((k) => k.revealable !== false);
    if (revealable && !revealedKeys[revealable.id]) {
      handleGuideKeySelect(revealable.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSetupGuide, mcpKeys, lastRevealedKey]);

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

  async function handleLegacyKeyCreate(k: McpApiKey) {
    setKeyActionId(k.id);
    setMessage(null);
    try {
      const result = await mcpKeysApi.create(k.name ? `${k.name} (new)` : 'my-agent');
      setNewlyCreatedKey({ key: result.key, name: result.name });
      setRevealedKeys((prev) => ({ ...prev, [result.id]: result.key }));
      setLastRevealedKey(result.key);
      setGuideKeyId(result.id);
      await loadMcpKeys();
      setMessage({ type: 'success', text: 'New key created — copy it now and configure your agent.' });
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create a new key' });
    } finally {
      setKeyActionId(null);
    }
  }

  async function handleRevealMcpKey(keyId: string) {
    if (revealedKeys[keyId]) {
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[keyId];
        return next;
      });
      return;
    }
    setKeyActionId(keyId);
    setMessage(null);
    try {
      const data = await mcpKeysApi.get(keyId);
      setRevealedKeys((prev) => ({ ...prev, [keyId]: data.key }));
      setLastRevealedKey(data.key);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to reveal key' });
    } finally {
      setKeyActionId(null);
    }
  }

  async function handleGuideKeySelect(keyId: string) {
    const key = mcpKeys.find((k) => k.id === keyId);
    if (!key || key.revealable === false) {
      setMessage({ type: 'error', text: 'This key was created before secure reveal was enabled, so it cannot be shown. Create a new key to view and copy it.' });
      return;
    }
    setKeyActionId(keyId);
    setMessage(null);
    try {
      const data = await mcpKeysApi.get(keyId);
      setRevealedKeys((prev) => ({ ...prev, [keyId]: data.key }));
      setLastRevealedKey(data.key);
      setGuideKeyId(keyId);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to reveal key' });
    } finally {
      setKeyActionId(null);
    }
  }

  const env = sysConfig.env || {};
  const li = sysConfig?.integrations?.find((i: any) => i.id === 'linear');
  const hasLinearKey = !!env.LINEAR_API_KEY;
  const linearConnected = li?.connected && hasLinearKey;
  const githubInt = sysConfig?.integrations?.find((i: any) => i.id === 'github');
  const slackFields = [
    { id: 'slack_bot_token', key: 'SLACK_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...', docUrl: 'https://api.slack.com/authentication/token-types#bot' },
    { id: 'slack_app_token', key: 'SLACK_APP_TOKEN', label: 'App Token', placeholder: 'xapp-...', docUrl: 'https://api.slack.com/authentication/token-types#app' },
  ];
  const configuredSlackCount = slackFields.filter((f) => !!env[f.key]).length;
  const allSlackConfigured = configuredSlackCount === slackFields.length;

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage integrations, API keys, and privacy settings</p>
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

      {/* ── Integrations ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Integrations</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Connect external tools to extend your team&apos;s workflow.</p>

        <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700">
          {/* Source Control subheader */}
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Source Control</h3>
          </div>

          {/* ── GitHub ─────────────────────────────────────────── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <GitPullRequest size={16} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-base font-medium text-gray-900 dark:text-gray-100">GitHub</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Connect your GitHub account</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {githubInt?.connected ? (
                <button
                  onClick={async () => {
                    try {
                      const { url } = await githubApi.getOAuthUrl();
                      window.location.href = url;
                    } catch {
                      setMessage({ type: 'error', text: 'Could not generate GitHub reconnection URL' });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-sm font-medium ring-1 ring-inset ring-gray-300 dark:ring-gray-600 bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Manage
                </button>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      const { url } = await githubApi.getOAuthUrl();
                      window.location.href = url;
                    } catch {
                      setMessage({ type: 'error', text: 'Could not generate GitHub OAuth URL' });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-sm font-medium ring-1 ring-inset ring-gray-300 dark:ring-gray-600 bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          <div className="h-px bg-gray-200 dark:bg-gray-700 mx-4" />

          {/* ── Bitbucket (beta) ───────────────────────────────── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <LinkIcon size={16} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-base font-medium text-gray-900 dark:text-gray-100">Bitbucket App Password</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Beta — connect via setup guide</div>
              </div>
            </div>
            <a
              href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/docs/platforms/bitbucket-setup.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Connect
              <ArrowUpRight size={12} />
            </a>
          </div>

          <div className="h-px bg-gray-200 dark:bg-gray-700 mx-4" />

          {/* Integrations subheader */}
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Integrations</h3>
          </div>

          {/* ── Linear ─────────────────────────────────────────── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <GitBranch size={16} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-base font-medium text-gray-900 dark:text-gray-100">Linear</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Sync issues and track progress</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {verifying['linear_key'] ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                  Connecting
                </span>
              ) : linearConnected ? (
                <button
                  onClick={() => setLinearExpanded(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-sm font-medium ring-1 ring-inset ring-gray-300 dark:ring-gray-600 bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Manage
                </button>
              ) : (
                <button
                  onClick={() => setLinearExpanded(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-sm font-medium ring-1 ring-inset ring-gray-300 dark:ring-gray-600 bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {linearExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
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
                        onChange={(e) => setApiKeyValues((prev) => ({ ...prev, linear_key: e.target.value }))}
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
                        setApiKeySaving((prev) => ({ ...prev, linear_key: true }));
                        setMessage(null);
                        try {
                          await configApi.updateEnv({ LINEAR_API_KEY: apiKeyValues['linear_key'] || '' });
                          setSysConfig((prev: any) => ({
                            ...prev,
                            env: { ...prev.env, LINEAR_API_KEY: apiKeyValues['linear_key'] || '' },
                          }));
                          setEditMode((prev) => ({ ...prev, linear_key: false }));
                          setMessage({ type: 'success', text: 'Linear API key saved.' });
                          setTimeout(() => setMessage(null), 3000);
                          if (apiKeyValues['linear_key']) {
                            setVerifying((prev) => ({ ...prev, linear_key: true }));
                            try {
                              const result = await configApi.verifyService('linear', apiKeyValues['linear_key']);
                              if (result.connected) {
                                setSysConfig((prev: any) => ({
                                  ...prev,
                                  integrations: prev.integrations?.map((i: any) =>
                                    i.id === 'linear' ? { ...i, connected: true } : i,
                                  ) || prev.integrations,
                                }));
                                setMessage({ type: 'success', text: 'Connected to Linear.' });
                              } else {
                                setMessage({ type: 'error', text: result.error || 'Failed to verify Linear API key' });
                              }
                            } catch {
                              setMessage({ type: 'error', text: 'Could not verify Linear API key — connection test failed' });
                            } finally {
                              setVerifying((prev) => ({ ...prev, linear_key: false }));
                            }
                          }
                        } catch (err) {
                          setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
                        } finally {
                          setApiKeySaving((prev) => ({ ...prev, linear_key: false }));
                        }
                      }}
                      disabled={apiKeySaving['linear_key']}
                      className="btn-primary text-xs min-h-[36px] px-3"
                    >
                      {apiKeySaving['linear_key'] ? '...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditMode((prev) => ({ ...prev, linear_key: false }))}
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
                          return v.length > 8 ? `${v.slice(0, 8)}••••••••` : '••••••••••••••••';
                        })()}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">Not configured</span>
                    )}
                    <button
                      onClick={() => {
                        if (env.LINEAR_API_KEY && !apiKeyValues['linear_key']) {
                          setApiKeyValues((prev) => ({ ...prev, linear_key: env.LINEAR_API_KEY }));
                        }
                        setEditMode((prev) => ({ ...prev, linear_key: true }));
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
                                setVerifying((prev) => ({ ...prev, linear_key: true }));
                                const result = await configApi.verifyService('linear', env.LINEAR_API_KEY);
                                if (result.connected) {
                                  setSysConfig((prev: any) => ({
                                    ...prev,
                                    integrations: prev.integrations?.map((i: any) =>
                                      i.id === 'linear' ? { ...i, connected: true } : i,
                                    ) || prev.integrations,
                                  }));
                                  setMessage({ type: 'success', text: 'Connected to Linear.' });
                                } else {
                                  setMessage({ type: 'error', text: result.error || 'Failed to verify Linear API key' });
                                }
                              } catch {
                                setMessage({ type: 'error', text: 'Could not verify Linear API key — connection test failed' });
                              } finally {
                                setVerifying((prev) => ({ ...prev, linear_key: false }));
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

          <div className="h-px bg-gray-200 dark:bg-gray-700 mx-4" />

          {/* ── Slack ──────────────────────────────────────────── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <MessageSquare size={16} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-base font-medium text-gray-900 dark:text-gray-100">Slack</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {configuredSlackCount === 0 ? 'Get notifications in your workspace' : `${configuredSlackCount}/${slackFields.length} fields configured`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {slackConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                  <button
                    onClick={() => setSlackExpanded(!slackExpanded)}
                    className="p-1.5 rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                </>
              ) : verifying['slack_bot_token'] ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                  Connecting
                </span>
              ) : (
                <button
                  onClick={() => setSlackExpanded(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-sm font-medium ring-1 ring-inset ring-gray-300 dark:ring-gray-600 bg-transparent text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {slackExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
              {slackFields.map((field) => {
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
                          onChange={(e) => setApiKeyValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                          placeholder={field.placeholder}
                          className="input-field flex-1 font-mono text-sm min-h-[36px]"
                        />
                        <button
                          onClick={async () => {
                            setApiKeySaving((prev) => ({ ...prev, [field.id]: true }));
                            setMessage(null);
                            try {
                              await configApi.updateEnv({ [field.key]: val || '' });
                              setSysConfig((prev: any) => ({
                                ...prev,
                                env: { ...prev.env, [field.key]: val || '' },
                              }));
                              setEditMode((prev) => ({ ...prev, [field.id]: false }));
                              setMessage({ type: 'success', text: `${field.label} saved.` });
                              setTimeout(() => setMessage(null), 3000);
                              if (field.id === 'slack_bot_token' && val) {
                                setVerifying((prev) => ({ ...prev, [field.id]: true }));
                                try {
                                  const result = await configApi.verifyService('slack', val);
                                  if (result.connected) setSlackConnected(true);
                                  setMessage({ type: result.connected ? 'success' : 'error', text: result.connected ? 'Slack connection verified!' : result.error || 'Verification failed' });
                                } catch {
                                  setMessage({ type: 'error', text: 'Could not verify Slack connection' });
                                } finally {
                                  setVerifying((prev) => ({ ...prev, [field.id]: false }));
                                }
                              }
                            } catch (err) {
                              setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
                            } finally {
                              setApiKeySaving((prev) => ({ ...prev, [field.id]: false }));
                            }
                          }}
                          disabled={apiKeySaving[field.id]}
                          className="btn-primary text-xs min-h-[36px] px-3"
                        >
                          {apiKeySaving[field.id] ? '...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditMode((prev) => ({ ...prev, [field.id]: false }))}
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
                              return v.length > 8 ? `${v.slice(0, 8)}••••••••` : '••••••••••••••••';
                            })()}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Not configured</span>
                        )}
                        <button
                          onClick={() => {
                            if (field.key && env[field.key] && !apiKeyValues[field.id]) {
                              setApiKeyValues((prev) => ({ ...prev, [field.id]: env[field.key] }));
                            }
                            setEditMode((prev) => ({ ...prev, [field.id]: true }));
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
              {allSlackConfigured && (
                <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
                  {verifying['slack_bot_token'] ? (
                    <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                      Connecting...
                    </span>
                  ) : (
                    <button
                      onClick={async () => {
                        setMessage(null);
                        setVerifying((prev) => ({ ...prev, slack_bot_token: true }));
                        try {
                          const result = await configApi.verifyService('slack', env.SLACK_BOT_TOKEN);
                          if (result.connected) setSlackConnected(true);
                          setMessage({ type: result.connected ? 'success' : 'error', text: result.connected ? 'Slack connection verified!' : result.error || 'Verification failed' });
                        } catch (err) {
                          setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Could not verify Slack connection' });
                        } finally {
                          setVerifying((prev) => ({ ...prev, slack_bot_token: false }));
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

          <div className="h-px bg-gray-200 dark:bg-gray-700 mx-4" />

          {/* ── Jira (beta) ────────────────────────────────────── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                <LinkIcon size={16} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <div className="text-base font-medium text-gray-900 dark:text-gray-100">Jira API Token</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Beta — connect via setup guide</div>
              </div>
            </div>
            <span
              aria-disabled="true"
              title="Setup guide coming soon"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 cursor-not-allowed select-none"
            >
              Connect
              <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </section>

      {/* ── MCP API Keys ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">MCP API Keys</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Keys for AI agents to connect to SYNTARO via MCP (set as SYNTARO_API_KEY in your agent)
        </p>

        <div className="mt-4 card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {mcpKeys.length} active
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowCreateKey((prev) => !prev)}
              className="btn-primary text-xs min-h-[32px] px-3"
            >
              <Plus size={14} className="inline mr-1" />
              Create key
            </button>
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
                  Key &quot;{newlyCreatedKey.name}&quot; created — copy it now, it will not be shown again.
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                  Use it as <code className="font-mono">SYNTARO_API_KEY</code> with <code className="font-mono">SYNTARO_API_URL={mcpApiUrl}</code> when configuring your agent (Claude Desktop, Cursor, OpenCode...).
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
                          {revealedKeys[k.id] ? (
                            <button
                              onClick={() => handleRevealMcpKey(k.id)}
                              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                              title="Hide key"
                            >
                              <EyeOff size={12} />
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (k.revealable === false) {
                                  handleLegacyKeyCreate(k);
                                } else {
                                  handleRevealMcpKey(k.id);
                                }
                              }}
                              disabled={keyActionId === k.id}
                              className={k.revealable === false
                                ? 'p-1 text-gray-300 dark:text-gray-600 hover:text-brand-600 dark:hover:text-brand-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
                                : 'p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'}
                              title={k.revealable === false ? 'This key was created before secure reveal was enabled, so it cannot be shown. Click to create a new key you can copy.' : 'Show key'}
                            >
                              <Eye size={12} />
                            </button>
                          )}
                          {revealedKeys[k.id] ? (
                            <>
                              <code className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all select-all">
                                {revealedKeys[k.id]}
                              </code>
                              <button
                                onClick={() => handleCopyKey(revealedKeys[k.id])}
                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                title="Copy key"
                              >
                                <Copy size={12} />
                              </button>
                            </>
                          ) : (
                            <code className="font-mono text-xs text-gray-400 select-all">{k.keyPrefix}••••••••</code>
                          )}
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

          <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                How to connect your AI agent
              </h4>
              <button
                onClick={() => setShowSetupGuide((prev) => !prev)}
                className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 font-medium"
              >
                {showSetupGuide ? 'Hide' : 'Show'} guide
              </button>
            </div>

            {showSetupGuide && (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">1. Create an API key and copy it</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Click <span className="font-medium">Create key</span>, give it a name (e.g. <code className="font-mono">claude-desktop</code>), then copy the key shown. It is displayed only once.
                  </p>
                </div>

                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">2. Configure the Remote MCP Server for your agent</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Your SYNTARO API URL is:
                  </p>
                  <code className="block rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 font-mono text-xs break-all select-all">
                    {mcpApiUrl}
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Option A — CLI (recommended). Register the remote MCP server for your agent:
                  </p>
                  <code className="block rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 font-mono text-xs break-all select-all">
                    npx syntaro install-mcp --claude --url {mcpApiUrl}
                  </code>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Use <code className="font-mono">--cursor</code> or <code className="font-mono">--opencode</code> for those agents, then restart the agent.
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Option B — manual JSON. Add a remote SSE server to your agent&apos;s MCP config (<code className="font-mono">claude_desktop_config.json</code>, <code className="font-mono">.cursor/mcp.json</code>, or <code className="font-mono">opencode.json</code>):
                  </p>
                  {mcpKeys.filter((k) => k.revealable !== false).length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      Key to use in this config:
                      <select
                        value={guideKeyId || ''}
                        onChange={(e) => handleGuideKeySelect(e.target.value)}
                        className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 font-mono text-xs text-gray-700 dark:text-gray-300"
                      >
                        <option value="">Select a key…</option>
                        {mcpKeys.map((k) => (
                          <option key={k.id} value={k.id} disabled={k.revealable === false}>
                            {k.name} ({k.keyPrefix}••••{k.revealable === false ? ' — cannot reveal' : ''})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => {
                        const key = guideJsonKey || '<SYNTARO_API_KEY>';
                        handleCopyKey(JSON.stringify({
                          mcpServers: {
                            syntaro: {
                              type: 'sse',
                              url: `${mcpApiUrl}/sse`,
                              headers: { Authorization: `Bearer ${key}` },
                            },
                          },
                        }, null, 2));
                      }}
                      className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title="Copy JSON config"
                    >
                      <Copy size={12} />
                    </button>
                    <div className="rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 break-all select-all">
                      <JsonCode
                        json={JSON.stringify({
                          mcpServers: {
                            syntaro: {
                              type: 'sse',
                              url: `${mcpApiUrl}/sse`,
                              headers: { Authorization: `Bearer ${guideJsonKey || '<SYNTARO_API_KEY>'}` },
                            },
                          },
                        }, null, 2)}
                      />
                    </div>
                    {guideJsonKey ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                        Your revealed key is already filled in — copy this JSON as-is.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <code className="font-mono">&lt;SYNTARO_API_KEY&gt;</code> is a placeholder — pick a key above to fill it in automatically, or click the eye icon on a key to reveal it.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">3. Set the SYNTARO API key</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Set the key you created as <code className="font-mono">SYNTARO_API_KEY</code> in your agent configuration — it is sent as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
                  </p>
                </div>

                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 space-y-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">4. Start using it</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    In your agent, ask something like: <span className="italic">&quot;fix these tickets&quot;</span> or <span className="italic">&quot;is there a ticket for X?&quot;</span>. The agent will check existing tickets and create new ones if needed.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Data & Privacy ────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Data &amp; Privacy</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage your data and privacy settings</p>

        <div className="mt-4 card">
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
      </section>
    </div>
  );
}
