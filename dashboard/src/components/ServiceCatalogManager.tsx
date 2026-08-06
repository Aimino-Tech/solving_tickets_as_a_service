import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { incidents } from '@/api/client';
import type { ServiceCatalogEntry } from '@/api/types';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import SlideOver from '@/components/SlideOver';
import { useI18n } from '@/i18n/I18nProvider';

interface CatalogForm {
  name: string;
  repos: string;
  purpose: string;
  runbook: string;
  providers: string;
}

const EMPTY_FORM: CatalogForm = { name: '', repos: '', purpose: '', runbook: '', providers: '' };

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ServiceCatalogManager() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ServiceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceCatalogEntry | null>(null);
  const [form, setForm] = useState<CatalogForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return incidents.serviceCatalog
      .list()
      .then((res) => setEntries(res.data ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setPanelOpen(true);
  }

  function openEdit(entry: ServiceCatalogEntry) {
    setEditing(entry);
    setForm({
      name: entry.name,
      repos: entry.repos.join(', '),
      purpose: entry.purpose ?? '',
      runbook: entry.runbook ?? '',
      providers: entry.providers.join(', '),
    });
    setFormError(null);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setEditing(null);
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      setFormError(t('incidents.catalog.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name,
        repos: parseList(form.repos),
        purpose: form.purpose.trim() || null,
        runbook: form.runbook.trim() || null,
        providers: parseList(form.providers),
      };
      if (editing) {
        await incidents.serviceCatalog.update(editing.id, body);
      } else {
        await incidents.serviceCatalog.create(body);
      }
      closePanel();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg.includes('409') || msg.includes('already exists') ? t('incidents.catalog.duplicate') : msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: ServiceCatalogEntry) {
    if (!window.confirm(t('incidents.catalog.deleteConfirm'))) return;
    try {
      await incidents.serviceCatalog.remove(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('incidents.catalog.desc')}</p>
        <button type="button" onClick={openCreate} className="btn-primary min-h-[44px]">
          <Plus size={16} className="mr-1 inline" />
          {t('incidents.catalog.add')}
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} retryLabel={t('common.retry')} />
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title={t('incidents.catalog.empty')} hint={t('incidents.catalog.emptyDesc')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  {t('incidents.catalog.tableName')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  {t('incidents.catalog.tableRepos')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  {t('incidents.catalog.tableProviders')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{entry.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {entry.repos.length > 0 ? entry.repos.join(', ') : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {entry.providers.length > 0 ? entry.providers.join(', ') : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(entry)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-500 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400"
                      aria-label={t('common.edit')}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                      aria-label={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideOver
        isOpen={panelOpen}
        onClose={closePanel}
        title={editing ? t('incidents.catalog.editTitle') : t('incidents.catalog.addTitle')}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="catalog-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('incidents.catalog.name')}
            </label>
            <input
              id="catalog-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field min-h-[44px] w-full"
              placeholder="payments-api"
            />
          </div>
          <div>
            <label htmlFor="catalog-repos" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('incidents.catalog.repos')}
            </label>
            <input
              id="catalog-repos"
              value={form.repos}
              onChange={(e) => setForm({ ...form, repos: e.target.value })}
              className="input-field min-h-[44px] w-full"
              placeholder="owner/repo-a, owner/repo-b"
            />
          </div>
          <div>
            <label
              htmlFor="catalog-providers"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('incidents.catalog.providers')}
            </label>
            <input
              id="catalog-providers"
              value={form.providers}
              onChange={(e) => setForm({ ...form, providers: e.target.value })}
              className="input-field min-h-[44px] w-full"
              placeholder="datadog, grafana"
            />
          </div>
          <div>
            <label
              htmlFor="catalog-purpose"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('incidents.catalog.purpose')}
            </label>
            <textarea
              id="catalog-purpose"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className="input-field w-full"
              rows={3}
            />
          </div>
          <div>
            <label
              htmlFor="catalog-runbook"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t('incidents.catalog.runbook')}
            </label>
            <textarea
              id="catalog-runbook"
              value={form.runbook}
              onChange={(e) => setForm({ ...form, runbook: e.target.value })}
              className="input-field w-full"
              rows={3}
            />
          </div>
          {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={closePanel} className="btn-secondary min-h-[44px]">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="btn-primary min-h-[44px]"
            >
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      </SlideOver>
    </div>
  );
}
