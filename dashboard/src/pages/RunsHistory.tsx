import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { runs } from '@/api/client';
import type { Run } from '@/api/types';
import BugView from '@/components/BugView';
import EvaluationView from '@/components/EvaluationView';
import ProjectOverview from '@/components/ProjectOverview';
import RunDetailContent from '@/components/RunDetailContent';
import RunListTab from '@/components/RunListTab';
import { useI18n } from '@/i18n/I18nProvider';

const TABS = [
  { id: 'overview', labelKey: 'overview.tab.overview' },
  { id: 'bug', labelKey: 'overview.tab.bugs' },
  { id: 'issues', labelKey: 'overview.tab.issues' },
  { id: 'pending', labelKey: 'overview.tab.pending' },
  { id: 'done', labelKey: 'overview.tab.done' },
  { id: 'evaluation', labelKey: 'overview.tab.evaluation' },
] as const;

const BADGED_TABS = new Set(['bug', 'issues', 'pending', 'done']);

type TabId = (typeof TABS)[number]['id'];

function isPending(status: Run['status']): boolean {
  return status === 'queued' || status === 'pending' || status === 'running';
}

function isDone(status: Run['status']): boolean {
  return status === 'success' || status === 'completed';
}

export default function RunsHistory() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [aside, setAside] = useState<{ run: Run } | null>(null);
  const [badgeRuns, setBadgeRuns] = useState<Run[]>([]);

  const rawTab = searchParams.get('tab');
  const effectiveTab: TabId =
    rawTab === 'bug' || searchParams.get('status') === 'failed'
      ? 'bug'
      : TABS.some((tab) => tab.id === rawTab)
        ? (rawTab as TabId)
        : 'overview';

  const refreshBadges = useCallback(async () => {
    try {
      const res = await runs.list({ perPage: 100 });
      setBadgeRuns(res.data);
    } catch {
      // keep last known counts
    }
  }, []);

  useEffect(() => {
    void refreshBadges();
  }, [refreshBadges]);

  const goTab = useCallback(
    (id: TabId) => {
      setSearchParams(id === 'overview' ? {} : { tab: id });
      void refreshBadges();
    },
    [setSearchParams, refreshBadges],
  );

  const tabCounts = useMemo(() => {
    const seen = new Set<string>();
    let issues = 0;
    let pending = 0;
    let done = 0;
    let bugs = 0;
    for (const run of badgeRuns) {
      if (run.status === 'failed') bugs++;
      if (isPending(run.status)) pending++;
      if (isDone(run.status)) done++;
      const key = `${run.repoOwner}/${run.repoName}#${run.issueNumber}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues++;
      }
    }
    return { bug: bugs, issues, pending, done };
  }, [badgeRuns]);

  const openDetail = useCallback((run: Run) => {
    setAside({ run });
    window.location.hash = `detail-${run.id}`;
  }, []);

  const closeDetail = useCallback(() => {
    setAside(null);
    window.location.hash = '';
  }, []);

  const handleSelectRun = useCallback(
    (run: Run) => {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        navigate(`/runs/${run.id}`);
        return;
      }
      openDetail(run);
    },
    [navigate, openDetail],
  );

  useEffect(() => {
    if (!aside) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [aside, closeDetail]);

  const headerTitle = aside ? `Run ${String(aside.run.id).slice(0, 8)}` : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
        {TABS.map((tab) => {
          const active = effectiveTab === tab.id;
          const count = BADGED_TABS.has(tab.id) ? tabCounts[tab.id as 'bug' | 'issues' | 'pending' | 'done'] : null;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => goTab(tab.id)}
              aria-pressed={active}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {t(tab.labelKey)}
              {count !== null && count > 0 && (
                <span
                  className={`ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    tab.id === 'bug'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                      : active
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {effectiveTab === 'overview' ? (
        <div className="flex items-start gap-6">
          {/* Project status overview — kanban pipeline + warnings + evaluation */}
          <div className="min-w-0 flex-1 space-y-6">
            <ProjectOverview onSelectRun={handleSelectRun} />
          </div>

          {/* Detail panel — pushes the main column instead of overlaying it */}
          <aside
            className={`hidden md:block shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
              aside ? 'w-full max-w-lg' : 'w-0'
            }`}
            aria-hidden={!aside}
          >
            <div className="sticky top-0 flex h-[calc(100vh-4rem)] w-[32rem] flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-4">
                <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{headerTitle}</h2>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">{aside ? <RunDetailContent run={aside.run} /> : null}</div>
            </div>
          </aside>
        </div>
      ) : effectiveTab === 'bug' ? (
        <BugView />
      ) : effectiveTab === 'evaluation' ? (
        <EvaluationView />
      ) : (
        <RunListTab kind={effectiveTab} />
      )}
    </div>
  );
}
