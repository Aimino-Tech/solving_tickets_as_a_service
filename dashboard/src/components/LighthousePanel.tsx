import { ArrowDown, ArrowUp, CheckCircle2, Gauge, Loader2, Minus, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluation, repos, tickets } from '@/api/client';
import type { LighthouseApiResponse, LighthouseFeedbackDelta, LighthouseSeverity } from '@/api/types';
import { useI18n } from '@/i18n/I18nProvider';

const POLL_INTERVAL_MS = 30_000;
const RUN_POLL_INTERVAL_MS = 5_000;
const RUN_POLL_TIMEOUT_MS = 150_000;
const TICKET_KEY = 'syntaro:lighthouse-tickets';

export type LighthousePlanTier = 'free' | 'solo' | 'team' | 'enterprise' | 'selfHosted';

function readCreatedTickets(): Set<string> {
  try {
    const raw = localStorage.getItem(TICKET_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeCreatedTickets(ids: Set<string>): void {
  try {
    localStorage.setItem(TICKET_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage unavailable — dedupe is best-effort
  }
}

export default function LighthousePanel({ tier }: { tier: LighthousePlanTier }) {
  const { t } = useI18n();
  const [data, setData] = useState<LighthouseApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submittedRef = useRef<Set<string>>(readCreatedTickets());
  const abortRef = useRef<AbortController | null>(null);

  const autoTicket = tier === 'team';

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    try {
      const res = await evaluation.lighthouse({ signal: ac.signal });
      if (!ac.signal.aborted) {
        setData(res);
        setRunning(false);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => loadData(false), POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [loadData]);

  const pollForRunCompletion = useCallback(async (startedAt: number) => {
    const deadline = Date.now() + RUN_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
      const res = await evaluation.lighthouse().catch(() => null);
      if (res?.lastRunAt && Date.parse(res.lastRunAt) >= startedAt) {
        setData(res);
        setRunning(false);
        return;
      }
    }
    setRunning(false);
    setError('lighthouse.runTimeout');
  }, []);

  async function handleRunSweep() {
    if (running) return;
    setRunning(true);
    setError(null);
    const startedAt = Date.now();
    try {
      await evaluation.runLighthouse();
      await pollForRunCompletion(startedAt);
    } catch (err) {
      setRunning(false);
      setError((err as Error).message);
    }
  }

  const createTicket = useCallback(
    async (item: { route: string; value: number | null; evidence: string; criteria: string }) => {
      const repo = await repos.list().catch(() => []);
      const first = repo.length > 0 ? repo[0] : null;
      if (!first) return null;
      const result = await tickets.create({
        repoOwner: first.owner,
        repoName: first.repo,
        issueTitle: `Quality: Lighthouse ${item.route} at ${item.value ?? '\u2014'}/100`,
        issueBody: `${item.criteria} — evidence: ${item.evidence}`,
        source: 'lighthouse-evaluation',
      });
      return result;
    },
    [],
  );

  const markSubmitted = useCallback((route: string) => {
    submittedRef.current.add(route);
    writeCreatedTickets(submittedRef.current);
  }, []);

  const autoSubmit = useCallback(
    async (item: {
      id: string;
      route: string;
      value: number | null;
      severity: LighthouseSeverity;
      evidence: string;
      criteria: string;
    }) => {
      if (!autoTicket || submittedRef.current.has(item.id)) return;
      const target =
        item.severity === 'critical' ||
        (item.severity === 'warning' && data?.feedback.some((f) => f.id === item.id && f.trend === 'regressed'));
      if (!target) return;
      submittedRef.current.add(item.id);
      setNotice(t('lighthouse.autoCreating', { route: item.route }));
      try {
        const result = await createTicket(item);
        if (result) {
          markSubmitted(item.id);
          setNotice(t('lighthouse.autoCreated', { runId: result.runId.slice(0, 8) }));
        } else {
          submittedRef.current.delete(item.id);
          setNotice(null);
        }
      } catch {
        submittedRef.current.delete(item.id);
        setNotice(null);
      }
    },
    [autoTicket, createTicket, data?.feedback, markSubmitted, t],
  );

  useEffect(() => {
    if (!data?.evaluation) return;
    for (const item of data.evaluation.rubric) {
      if (item.severity === 'empty' || item.severity === 'good') continue;
      void autoSubmit(item);
    }
  }, [data, autoSubmit]);

  const feedbackMap = useMemo(() => {
    const map = new Map<string, LighthouseFeedbackDelta>();
    for (const f of data?.feedback ?? []) map.set(f.id, f);
    return map;
  }, [data]);

  const evaluationData = data?.evaluation ?? null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Gauge size={16} className="text-brand-600 dark:text-brand-400" />
          {t('lighthouse.title')}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {notice && (
            <span className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
              <Loader2 size={12} className="animate-spin" />
              {notice}
            </span>
          )}
          {data?.lastRunAt && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('lighthouse.lastRun')}: {new Date(data.lastRunAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => loadData(false)}
            disabled={loading}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-50 dark:hover:text-gray-300"
            aria-label={t('dashboard.refresh')}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void handleRunSweep()}
            disabled={running}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? t('lighthouse.running') : t('lighthouse.runSweep')}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error === 'lighthouse.runTimeout' ? t('lighthouse.runTimeout') : error}
        </p>
      )}

      {!evaluationData ? (
        <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('lighthouse.empty')}
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4 font-medium">{t('lighthouse.route')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.value')}</th>
                  <th className="hidden pb-2 pr-4 font-medium sm:table-cell">{t('overview.evaluation.evidence')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.verdict')}</th>
                  <th className="pb-2 font-medium">{t('overview.evaluation.trend')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {evaluationData.rubric.map((item) => {
                  const delta = feedbackMap.get(item.id);
                  return (
                    <tr key={item.id}>
                      <td className="py-2 pr-4">
                        <span className="font-mono text-xs text-gray-900 dark:text-gray-100">{item.route}</span>
                        <span className="ml-2 hidden text-[11px] text-gray-400 md:inline">{item.criteria}</span>
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-gray-700 dark:text-gray-300">
                        {item.value === null ? '\u2014' : `${item.value}/100`}
                      </td>
                      <td className="hidden py-2 pr-4 text-xs text-gray-500 dark:text-gray-400 sm:table-cell">
                        {item.evidence}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(item.severity)}`}
                        >
                          {t(`overview.verdicts.${item.severity}`)}
                        </span>
                      </td>
                      <td className="py-2">{delta ? <TrendCell delta={delta} /> : '\u2014'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('overview.evaluation.score')}:</span>
            <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {evaluationData.score === null ? '\u2014' : `${evaluationData.score}/100`}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadge(evaluationData.verdict)}`}
            >
              {t(`overview.verdicts.${evaluationData.verdict}`)}
            </span>
            {evaluationData.actions.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {evaluationData.actions.map((action) => (
                  <span
                    key={action}
                    className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300"
                  >
                    {t(action)}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <CheckCircle2 size={12} />
              {t('lighthouse.threshold')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function TrendCell({ delta }: { delta: LighthouseFeedbackDelta }) {
  const { t } = useI18n();
  if (delta.trend === 'new') {
    return <span className="text-xs text-gray-400 dark:text-gray-500">{t('overview.evaluation.trendNew')}</span>;
  }
  if (delta.trend === 'unchanged') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
        <Minus size={12} />
        {t('overview.evaluation.trendSame')}
      </span>
    );
  }
  const improved = delta.trend === 'improved';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${improved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
    >
      {improved ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {delta.delta === null ? '' : `${improved ? '+' : ''}${delta.delta}`}
      {t(`overview.evaluation.trend${improved ? 'Improved' : 'Regressed'}`)}
    </span>
  );
}

function severityBadge(severity: LighthouseSeverity): string {
  switch (severity) {
    case 'good':
      return 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300';
    case 'warning':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
    case 'critical':
      return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
}
