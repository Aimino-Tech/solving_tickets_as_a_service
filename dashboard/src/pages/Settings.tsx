import { useState, useEffect } from 'react';
import { settings } from '@/api/client';

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

  useEffect(() => {
    settings
      .get()
      .then((data) => {
        setConfig(data);
        setForm(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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
            <div className="h-4 w-32 rounded bg-gray-200" />
            <div className="mt-1 h-10 w-full rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card">
        <h3 className="text-base font-semibold text-gray-900">Bot Configuration</h3>
        <p className="mt-1 text-sm text-gray-500">
          Configure how the STAS bot behaves for your repositories.
        </p>

        <form onSubmit={handleSave} className="mt-6 space-y-5">
          {/* Trigger label */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Trigger Label</label>
            <p className="text-xs text-gray-500">Issue label that triggers the bot.</p>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="input-field mt-1 max-w-xs"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Model</label>
            <p className="text-xs text-gray-500">AI model used for fix runs.</p>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className="input-field mt-1 max-w-md"
              placeholder="e.g. aimino/agi-v1"
            />
          </div>

          {/* Max concurrent */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Max Concurrent Fixes</label>
            <p className="text-xs text-gray-500">Maximum number of fixes running simultaneously.</p>
            <input
              type="number"
              min={1}
              max={50}
              value={form.maxConcurrent}
              onChange={(e) => setForm({ ...form, maxConcurrent: Number(e.target.value) })}
              className="input-field mt-1 max-w-[120px]"
            />
          </div>

          {/* Sandbox pool */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Sandbox Pool Size</label>
            <p className="text-xs text-gray-500">Number of pre-warmed sandbox environments.</p>
            <input
              type="number"
              min={0}
              max={100}
              value={form.sandboxPoolSize}
              onChange={(e) => setForm({ ...form, sandboxPoolSize: Number(e.target.value) })}
              className="input-field mt-1 max-w-[120px]"
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
            <label htmlFor="auditLog" className="text-sm font-medium text-gray-700">
              Enable audit logging
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <div className="flex gap-3 pt-2">
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
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <h3 className="text-base font-semibold text-red-800">Danger Zone</h3>
        <p className="mt-1 text-sm text-red-600">
          These actions are irreversible. Proceed with caution.
        </p>
        <div className="mt-4 flex gap-3">
          <button className="btn-danger text-xs">Reset All Settings</button>
        </div>
      </div>
    </div>
  );
}
