import { useState, useEffect } from 'react';
import { request, configApi, github as githubApi, mcpKeysApi } from '@/api/client';
import type { McpApiKey } from '@/api/types';
import {
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Copy,
  Trash2,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react';

/* ── Brand SVG Icons ─────────────────────────────────────────── */

function GithubLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function GitlabLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#FC6D26" d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51c.06-.18.26-.3.46-.3.2 0 .39.11.46.29l2.42 7.45h8.9l2.42-7.45c.07-.18.26-.29.46-.29.2 0 .4.12.46.3l2.44 7.51 1.22 3.78a.84.84 0 01-.3.94z" />
      <path fill="#E24329" d="M12 22.13L1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78L12 22.13z" />
      <path fill="#FCA326" d="M1.05 13.45l1.22-3.78 3.68 11.33L1.05 13.45z" />
      <path fill="#E24329" d="M12 22.13l10.65-7.74a.84.84 0 00.3-.94l-1.22-3.78L12 22.13z" />
      <path fill="#FCA326" d="M22.95 13.45l-1.22-3.78-3.68 11.33 4.9-7.55z" />
    </svg>
  );
}

function AzureDevopsLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#0078D4" d="M0 8.868L4.697 4.5 14.28 1.5 24 6.787v10.426l-9.72 5.287-9.583-3-4.697-4.368z" />
      <path fill="#005A9E" d="M4.697 4.5l9.583 12.713L24 6.787v10.426l-9.72 5.287-9.583-3L0 15.132V8.868L4.697 4.5z" />
      <path fill="#50E6FF" opacity="0.8" d="M14.28 1.5L4.697 4.5v10.632l9.583 2.081L24 6.787 14.28 1.5z" />
      <path fill="#0078D4" d="M4.697 4.5L14.28 1.5v15.713L4.697 15.132V4.5z" />
    </svg>
  );
}

function BitbucketLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#2684FF" d="M2.6 3c-.4 0-.7.3-.8.7l-1.8 13.6c-.1.5.3.9.8.9h18.4c.4 0 .8-.4.8-.9L18.2 3.7c-.1-.4-.4-.7-.8-.7H2.6zM13.6 12.8H6.4L5.2 6.5h9.6l-1.2 6.3z" />
    </svg>
  );
}

function SlackLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#E01E5A" d="M6 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm0-2.5a2.5 2.5 0 0 0 2.5-2.5V6a2.5 2.5 0 1 0-5 0v4A2.5 2.5 0 0 0 6 12.5z" />
      <path fill="#36C5F0" d="M9 6a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0zm2.5 0A2.5 2.5 0 0 0 14 3.5V1a2.5 2.5 0 1 0-5 0v2.5A2.5 2.5 0 0 0 11.5 6z" />
      <path fill="#2EB67D" d="M18 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 2.5a2.5 2.5 0 0 0-2.5 2.5V18a2.5 2.5 0 1 0 5 0v-4a2.5 2.5 0 0 0-2.5-2.5z" />
      <path fill="#ECB22E" d="M15 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0zm-2.5 0a2.5 2.5 0 0 0-2.5 2.5V23a2.5 2.5 0 1 0 5 0v-2.5a2.5 2.5 0 0 0-2.5-2.5z" />
    </svg>
  );
}

function TeamsLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#5059C9" d="M19.5 7.5A2.5 2.5 0 1 0 17 5a2.5 2.5 0 0 0 2.5 2.5zm-1.5 1h-2a1.5 1.5 0 0 0-1.5 1.5v3.5h7V10A1.5 1.5 0 0 0 20 8.5z" />
      <path fill="#7B83EB" d="M12.5 6.5a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0zm-6 4.5A2.5 2.5 0 0 0 4 13.5V18a2.5 2.5 0 0 0 2.5 2.5h6A2.5 2.5 0 0 0 15 18v-4.5A2.5 2.5 0 0 0 12.5 11z" />
    </svg>
  );
}

function LinearLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} fill="none">
      <path d="M1.75 12a10.25 10.25 0 1 1 20.5 0 10.25 10.25 0 0 1-20.5 0Z" fill="currentColor" fillOpacity="0.1" />
      <path d="M3.5 12a8.5 8.5 0 0 0 14.5 6.01L5.99 6.01A8.47 8.47 0 0 0 3.5 12Z" fill="currentColor" />
      <path d="M7.4 4.6 19.4 16.6A8.5 8.5 0 0 0 7.4 4.6Z" fill="currentColor" />
    </svg>
  );
}

function JiraLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className}>
      <path fill="#2684FF" d="M11.53 2c0 2.4-1.97 4.35-4.4 4.35H3.59V9.9c0 2.4-1.96 4.35-4.4 4.35v6.16c5.96 0 10.8-4.8 10.8-10.74V2h1.54z" />
      <path fill="#0052CC" d="M12.47 2c0 5.94 4.84 10.74 10.8 10.74V6.58c-2.44 0-4.4-1.95-4.4-4.35h-3.54V2h-2.86z" />
    </svg>
  );
}

function SentryLogo({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} fill="currentColor">
      <path d="M13.2 2.6a1.5 1.5 0 0 0-2.4 0L1.7 16.3c-.6.9 0 2.1 1.2 2.1h6.6c-.3-.9-.1-1.9.5-2.6l4.2-5.4L13.2 2.6zM15 12l-2.6 3.4c-.3.4-.3.9 0 1.3l.9 1.1c.3.4.8.4 1.1 0L17 14.4c.3-.4.3-.9 0-1.3l-.9-1.1c-.3-.4-.8-.4-1.1 0zM17.5 17.5c-.3.4-.3.9 0 1.3l.9 1.1c.3.4.8.4 1.1 0l2.6-3.4c.3-.4.3-.9 0-1.3l-.9-1.1c-.3-.4-.8-.4-1.1 0l-2.6 3.4z" />
    </svg>
  );
}

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
  }, []);

  useEffect(() => {
    if (!showSetupGuide || lastRevealedKey) return;
    const revealable = mcpKeys.find((k) => k.revealable !== false);
    if (revealable && !revealedKeys[revealable.id]) {
      handleGuideKeySelect(revealable.id);
    }
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

  const iconContainerClass = "integration-icon-container bg-gray-100 dark:bg-gray-800/80 flex size-7 shrink-0 items-center justify-center rounded-lg [&_img]:size-[18px] [&_img]:max-h-[18px] [&_img]:max-w-[18px] [&_img]:object-contain [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-gray-700 dark:[&_svg]:text-gray-300";

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

      {/* ── Source Control Section ────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Source Control</h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 shadow-sm">
          {/* ── GitHub ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <GithubLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">GitHub</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {githubInt?.connected
                    ? 'Connected as xdnaimino to repositories accessible in organizations: Aimino-Tech'
                    : 'Connect your GitHub account for Cloud Agents and automated PRs'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                >
                  Manage
                  <ChevronDown size={14} className="text-gray-400" />
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
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                >
                  Connect
                  <ArrowUpRight size={13} className="text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* ── GitLab ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <GitlabLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">GitLab</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Connect GitLab for Cloud Agents, Bugbot and enhanced codebase context
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setMessage({ type: 'error', text: 'GitLab connection guide coming soon' })}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
              >
                Connect
                <ArrowUpRight size={13} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* ── Azure DevOps ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <AzureDevopsLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Azure DevOps</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Connect Azure DevOps for Cloud Agents and enhanced codebase context
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setMessage({ type: 'error', text: 'Azure DevOps setup guide coming soon' })}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
              >
                Connect
                <ArrowUpRight size={13} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* ── Bitbucket Cloud (App Password) ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <BitbucketLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bitbucket App Password</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Connect Bitbucket Cloud for Cloud Agents, Bugbot and enhanced codebase context
                </div>
              </div>
            </div>
            <a
              href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/blob/main/docs/platforms/bitbucket-setup.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors shrink-0"
            >
              Connect
              <ArrowUpRight size={13} className="text-gray-400" />
            </a>
          </div>

          {/* ── Bitbucket Data Center ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <BitbucketLogo className="size-[18px] grayscale opacity-70" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bitbucket Data Center</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Ask a team admin to connect an instance
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500 select-none">
                Team Admin Required
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrations Section ────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Integrations</h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800 shadow-sm">
          {/* ── Slack ── */}
          <div className="p-4 space-y-3">
            <div className="flex flex-row flex-nowrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={iconContainerClass}>
                  <SlackLogo />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Slack</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    Work with Cloud Agents from Slack
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {slackConnected ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Connected
                    </span>
                    <button
                      onClick={() => setSlackExpanded(!slackExpanded)}
                      className="p-1.5 rounded-md transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                  </>
                ) : verifying['slack_bot_token'] ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    Connecting
                  </span>
                ) : (
                  <button
                    onClick={() => setSlackExpanded(!slackExpanded)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                  >
                    Connect
                    <ArrowUpRight size={13} className="text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            {slackExpanded && (
              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-3">
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
          </div>

          {/* ── Microsoft Teams ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <TeamsLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Microsoft Teams</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Work with Cloud Agents from Microsoft Teams
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setMessage({ type: 'error', text: 'Microsoft Teams integration guide coming soon' })}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
              >
                Connect
                <ArrowUpRight size={13} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* ── Linear ── */}
          <div className="p-4 space-y-3">
            <div className="flex flex-row flex-nowrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={iconContainerClass}>
                  <LinearLogo />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Linear</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    Connect a Linear workspace to delegate issues to Cloud Agents
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {verifying['linear_key'] ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    Connecting
                  </span>
                ) : linearConnected ? (
                  <button
                    onClick={() => setLinearExpanded(!linearExpanded)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                  >
                    Manage
                    <ChevronDown size={14} className="text-gray-400" />
                  </button>
                ) : (
                  <button
                    onClick={() => setLinearExpanded(!linearExpanded)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
                  >
                    Connect
                    <ArrowUpRight size={13} className="text-gray-400" />
                  </button>
                )}
              </div>
            </div>

            {/* Linear API Key input inline field */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800/60 space-y-2">
              <div className="flex items-center gap-2">
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
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Jira ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <JiraLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Jira API Token</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Connect a Jira site to delegate issues to Cloud Agents
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                aria-disabled="true"
                title="Setup guide coming soon"
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 cursor-not-allowed select-none"
              >
                Connect
                <ArrowUpRight size={13} />
              </span>
            </div>
          </div>

          {/* ── Sentry ── */}
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={iconContainerClass}>
                <SentryLogo />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sentry</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  Use Sentry issue events in Automations
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setMessage({ type: 'error', text: 'Sentry setup guide coming soon' })}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
              >
                Connect
                <ArrowUpRight size={13} className="text-gray-400" />
              </button>
            </div>
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
