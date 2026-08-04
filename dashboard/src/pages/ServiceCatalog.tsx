import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FolderKanban, Plus, Trash2 } from 'lucide-react';
import { serviceCatalog } from '@/api/client';
import type { ServiceCatalogEntry } from '@/api/types';
import { useI18n } from '@/i18n/I18nProvider';
import { SkeletonTable } from '@/components/LoadingSkeleton';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function parseRepos(value: string): Array<{ owner: string; repo: string }> {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((full) => {
      const [owner, repo] = full.split('/');
      return { owner: owner ?? '', repo: repo ?? full };
    })
    .filter((r) => r.owner && r.repo);
}

function formatRepos(repos: Array<{ owner: string; repo: string }>): string {
  return repos.map((r) => `${r.owner}/${r.repo}`).join(', ');
}

const EMPTY_FORM = { name: '', purpose: '', repos: '' };

export default function ServiceCatalog() {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await serviceCatalog.list();
      setServices(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(service: ServiceCatalogEntry) {
    setEditingId(service.id);
    setForm({ name: service.name, purpose: service.purpose ?? '', repos: formatRepos(service.repos) });
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const repos = parseRepos(form.repos);
      if (editingId === null) {
        await serviceCatalog.create({ name: form.name.trim(), purpose: form.purpose.trim() || null, repos });
        setNotice(t('serviceCatalog.created'));
      } else {
        await serviceCatalog.update(editingId, { purpose: form.purpose.trim() || null, repos });
        setNotice(t('serviceCatalog.updated'));
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t('serviceCatalog.delete'))) return;
    setError(null);
    try {
      await serviceCatalog.remove(id);
      setNotice(t('serviceCatalog.deleted'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/incidents"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" /> {t('serviceCatalog.backToIncidents')}
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
            <FolderKanban className="h-5 w-5 text-brand-600 dark:text-brand-400" /> {t('serviceCatalog.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('serviceCatalog.subtitle')}</p>
        </div>
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" /> {t('serviceCatalog.add')}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/40 dark:text-green-300">
          {notice}
        </div>
      )}

      {/* Create / edit form */}
      {formOpen && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {editingId === null ? t('serviceCatalog.add') : t('serviceCatalog.edit')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('serviceCatalog.name')} *
              </span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={editingId !== null}
                className="input-field min-h-[44px] w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('serviceCatalog.purpose')}
              </span>
              <input
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                className="input-field min-h-[44px] w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('serviceCatalog.repos')}
              </span>
              <input
                value={form.repos}
                onChange={(e) => setForm((f) => ({ ...f, repos: e.target.value }))}
                placeholder={t('serviceCatalog.reposPlaceholder')}
                className="input-field min-h-[44px] w-full"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="btn-primary text-sm">
              {saving ? '…' : t('serviceCatalog.save')}
            </button>
            <button
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
              className="btn-secondary text-sm"
            >
              {t('serviceCatalog.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('serviceCatalog.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('serviceCatalog.purpose')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{t('serviceCatalog.repos')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <SkeletonTable rows={4} columns={4} />
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-4">
                  <ErrorState message={error} onRetry={() => void load()} />
                </td>
              </tr>
            ) : (services ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4">
                  <EmptyState title={t('serviceCatalog.noServices')} hint={t('serviceCatalog.noServicesDesc')} />
                </td>
              </tr>
            ) : (
              (services ?? []).map((service) => (
                <tr key={service.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{service.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{service.purpose ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {service.repos.length === 0 ? (
                        <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                      ) : (
                        service.repos.map((repo) => (
                          <span
                            key={`${service.id}-${repo.owner}/${repo.repo}`}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                          >
                            {repo.owner}/{repo.repo}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(service)} className="btn-secondary text-xs">
                        {t('serviceCatalog.edit')}
                      </button>
                      <button
                        onClick={() => void remove(service.id)}
                        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/40"
                        aria-label={t('serviceCatalog.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
