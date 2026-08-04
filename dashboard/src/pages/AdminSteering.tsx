import { useCallback, useEffect, useState } from 'react';
import {
  adminSteering,
  type OsBackupListResponse,
  type OsHealthStatus,
  type OsMaintenanceStatus,
} from '@/api/adminSteering';
import { SkeletonCardGrid } from '@/components/LoadingSkeleton';
import { useI18n } from '@/i18n/I18nProvider';

type PageState = 'loading' | 'ready' | 'error';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export default function AdminSteering() {
  const { t } = useI18n();
  const [state, setState] = useState<PageState>('loading');
  const [pageError, setPageError] = useState<string>('');

  const [health, setHealth] = useState<OsHealthStatus | null>(null);
  const [maintenance, setMaintenance] = useState<OsMaintenanceStatus | null>(null);
  const [loadLevel, setLoadLevel] = useState<string>('—');
  const [errorBudget, setErrorBudget] = useState<Record<string, number>>({});
  const [backups, setBackups] = useState<OsBackupListResponse | null>(null);

  const [busy, setBusy] = useState<string>('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [confirming, setConfirming] = useState<string>('');
  const [tenantId, setTenantId] = useState('');
  const [paymentIntent, setPaymentIntent] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [drainMinutes, setDrainMinutes] = useState(5);

  const runAction = useCallback(async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      setFlash({ kind: 'ok', text: okText });
    } catch (err) {
      setFlash({ kind: 'err', text: errMessage(err) });
    } finally {
      setBusy('');
      setConfirming('');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [h, m, l, eb, bk] = await Promise.all([
        adminSteering.health(),
        adminSteering.maintenanceStatus(),
        adminSteering.load(),
        adminSteering.errorBudget(),
        adminSteering.backups(),
      ]);
      setHealth(h);
      setMaintenance(m);
      setLoadLevel(l.load_level);
      setErrorBudget(eb);
      setBackups(bk);
      setState('ready');
    } catch (err) {
      setPageError(errMessage(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPaused = health?.emergency_paused === true;

  if (state === 'loading') {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">{t('steering.title')}</h1>
        <SkeletonCardGrid count={3} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-gray-100">{t('steering.title')}</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">{t('steering.unreachable')}</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{pageError}</p>
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">{t('steering.envHint')}</p>
          <button
            type="button"
            onClick={() => {
              setState('loading');
              void refresh();
            }}
            className="mt-4 min-h-[44px] rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            {t('steering.retry')}
          </button>
        </div>
      </div>
    );
  }

  const card = 'rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800';
  const cardHeader = 'border-b border-gray-200 px-4 py-3 dark:border-gray-700';
  const label = 'text-xs font-medium text-gray-500 dark:text-gray-400';
  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
  const dangerBtn =
    'min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';
  const okBtn =
    'min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
  const ghostBtn =
    'min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50';

  const loadColor =
    loadLevel === 'critical'
      ? 'text-red-600 dark:text-red-400'
      : loadLevel === 'elevated'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-green-600 dark:text-green-400';
  const budgetEntries = Object.entries(errorBudget);
  const backupList = Array.isArray(backups?.backups) ? backups.backups : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('steering.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('steering.subtitle')} —{' '}
            {health ? `proxy ${health.proxy}, stripe ${health.stripe}` : t('steering.statusUnavailable')}
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} className={ghostBtn}>
          {t('steering.refresh')}
        </button>
      </div>

      {flash && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            flash.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {flash.text}
        </div>
      )}

      {/* Emergency stop/resume */}
      <div className={`${card} mb-6`}>
        <div className={cardHeader}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.emergencyTitle')}</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                isPaused
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isPaused ? 'bg-red-500' : 'bg-green-500'}`} />
              {isPaused ? t('steering.emergencyActive') : t('steering.runningNormally')}
            </span>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('steering.emergencyDesc')}</p>
          </div>
          <div className="flex gap-2">
            {confirming === 'stop' ? (
              <>
                <button
                  type="button"
                  onClick={() => void runAction('stop', adminSteering.emergencyPause, t('steering.emergencyPaused'))}
                  disabled={busy !== ''}
                  className={dangerBtn}
                >
                  {busy === 'stop' ? t('steering.engaging') : t('steering.confirmStop')}
                </button>
                <button type="button" onClick={() => setConfirming('')} disabled={busy !== ''} className={ghostBtn}>
                  {t('steering.cancel')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming('stop')}
                disabled={busy !== '' || isPaused}
                className={dangerBtn}
              >
                {t('steering.emergencyStop')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void runAction('resume', adminSteering.emergencyResume, t('steering.emergencyResumed'))}
              disabled={busy !== '' || !isPaused}
              className={okBtn}
            >
              {busy === 'resume' ? t('steering.resuming') : t('steering.resume')}
            </button>
          </div>
        </div>
      </div>

      {/* Tenant kill / refund */}
      <div className={`${card} mb-6`}>
        <div className={cardHeader}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.tenantTitle')}</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <div>
            <label htmlFor="tenant-id" className={label}>
              {t('steering.tenantIdLabel')}
            </label>
            <input
              id="tenant-id"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder={t('steering.tenantIdPlaceholder')}
              className={`${inputCls} mt-1`}
            />
            <div className="mt-3 flex gap-2">
              {confirming === 'kill' ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(
                        'kill',
                        () => adminSteering.killTenant(tenantId),
                        t('steering.tenantKilled', { tenant: tenantId }),
                      )
                    }
                    disabled={busy !== ''}
                    className={dangerBtn}
                  >
                    {busy === 'kill' ? t('steering.killing') : t('steering.confirmKill')}
                  </button>
                  <button type="button" onClick={() => setConfirming('')} disabled={busy !== ''} className={ghostBtn}>
                    {t('steering.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming('kill')}
                  disabled={busy !== '' || tenantId.trim() === ''}
                  className={dangerBtn}
                >
                  {t('steering.kill')}
                </button>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="payment-intent" className={label}>
              {t('steering.paymentIntentLabel')}
            </label>
            <input
              id="payment-intent"
              value={paymentIntent}
              onChange={(e) => setPaymentIntent(e.target.value)}
              placeholder={t('steering.paymentIntentPlaceholder')}
              className={`${inputCls} mt-1`}
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    'refund',
                    () => adminSteering.refundTenant(tenantId, { payment_intent: paymentIntent, kill: false }),
                    t('steering.tenantRefunded', { tenant: tenantId }),
                  )
                }
                disabled={busy !== '' || tenantId.trim() === '' || paymentIntent.trim() === ''}
                className={okBtn}
              >
                {busy === 'refund' ? t('steering.refunding') : t('steering.refund')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance */}
      <div className={`${card} mb-6`}>
        <div className={cardHeader}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.maintenanceTitle')}</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                maintenance?.active
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${maintenance?.active ? 'bg-amber-500' : 'bg-gray-300'}`} />
              {maintenance?.active
                ? t('steering.maintenanceActive', { reason: maintenance.reason ?? '—' })
                : t('steering.maintenanceOff')}
            </span>
            {maintenance?.active && maintenance.drain_deadline && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t('steering.drainDeadline')} {new Date(maintenance.drain_deadline).toLocaleString()}
              </p>
            )}
            {!maintenance?.active && (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={maintenanceReason}
                  onChange={(e) => setMaintenanceReason(e.target.value)}
                  placeholder={t('steering.reasonPlaceholder')}
                  className={`${inputCls} max-w-xs`}
                />
                <input
                  type="number"
                  min={1}
                  value={drainMinutes}
                  onChange={(e) => setDrainMinutes(Number(e.target.value))}
                  className={`${inputCls} w-24`}
                />
                <span className="self-center text-xs text-gray-500 dark:text-gray-400">
                  {t('steering.drainMinutes')}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {!maintenance?.active ? (
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    'maint',
                    () => adminSteering.maintenanceActivate(maintenanceReason || 'manual', drainMinutes || 5),
                    t('steering.maintenanceActivated'),
                  )
                }
                disabled={busy !== ''}
                className={okBtn}
              >
                {busy === 'maint' ? t('steering.activating') : t('steering.maintenanceActivate')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void runAction('maint', adminSteering.maintenanceDeactivate, t('steering.maintenanceDeactivated'))
                }
                disabled={busy !== ''}
                className={okBtn}
              >
                {busy === 'maint' ? t('steering.deactivating') : t('steering.maintenanceDeactivate')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Load + error budget */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className={cardHeader}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.load')}</h2>
          </div>
          <div className="p-4">
            <p className={`text-2xl font-bold capitalize ${loadColor}`}>{loadLevel}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('steering.loadDesc')}</p>
          </div>
        </div>
        <div className={card}>
          <div className={cardHeader}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.errorBudget')}</h2>
          </div>
          <div className="p-4">
            {budgetEntries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('steering.noErrorBudget')}</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {budgetEntries.map(([component, remaining]) => (
                  <li key={component} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{component}</span>
                    <span
                      className={`text-sm font-semibold ${remaining >= 0.5 ? 'text-green-600 dark:text-green-400' : remaining >= 0.2 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {Math.round(remaining * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Backup */}
      <div className={card}>
        <div className={`${cardHeader} flex items-center justify-between`}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('steering.backupsTitle')}</h2>
          <button
            type="button"
            onClick={() => void runAction('backup', adminSteering.backupRun, t('steering.backupStarted'))}
            disabled={busy !== ''}
            className={okBtn}
          >
            {busy === 'backup' ? t('steering.runningBusy') : t('steering.backupRun')}
          </button>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {backupList.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('steering.noBackups')}
            </div>
          ) : (
            backupList.map((b, i) => {
              const row = (b ?? {}) as Record<string, unknown>;
              const when =
                typeof row.when === 'string' ? row.when : typeof row.started_at === 'string' ? row.started_at : '';
              const name =
                typeof row.name === 'string' ? row.name : typeof row.id === 'string' ? row.id : `Backup ${i + 1}`;
              const rowKey =
                typeof row.name === 'string'
                  ? row.name
                  : typeof row.id === 'string'
                    ? row.id
                    : typeof row.when === 'string'
                      ? row.when
                      : `backup-${i}`;
              return (
                <div key={rowKey} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {when ? new Date(when).toLocaleString() : JSON.stringify(row)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
