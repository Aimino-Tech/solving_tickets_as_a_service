import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Run } from '@/api/types';
import ProjectOverview from '@/components/ProjectOverview';
import RunDetailContent from '@/components/RunDetailContent';
import StatusBadge from '@/components/StatusBadge';
import { useI18n } from '@/i18n/I18nProvider';

type AsideState =
  | { mode: 'run'; run: Run }
  | { mode: 'list'; runs: Run[]; titleKey: string; descKey: string };

export default function RunsHistory() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [aside, setAside] = useState<AsideState | null>(null);

  const openDetail = useCallback((run: Run) => {
    setAside({ mode: 'run', run });
    window.location.hash = `detail-${run.id}`;
  }, []);

  const openBrowse = useCallback((runs: Run[], titleKey: string, descKey: string) => {
    setAside({ mode: 'list', runs, titleKey, descKey });
    window.location.hash = 'browse';
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

  const handleBrowseRuns = useCallback(
    (runs: Run[], titleKey: string, descKey: string) => {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        if (runs[0]) navigate(`/runs/${runs[0].id}`);
        return;
      }
      openBrowse(runs, titleKey, descKey);
    },
    [navigate, openBrowse],
  );

  useEffect(() => {
    if (!aside) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [aside, closeDetail]);

  const headerTitle =
    aside?.mode === 'run' ? `Run ${String(aside.run.id).slice(0, 8)}` : aside ? t(aside.titleKey) : '';

  return (
    <div className="flex items-start gap-6">
      {/* Project status overview — kanban pipeline + warnings + evaluation */}
      <div className="min-w-0 flex-1 space-y-6">
        <ProjectOverview
          onSelectRun={handleSelectRun}
          onBrowseRuns={(runs, titleKey, descKey) => handleBrowseRuns(runs, titleKey, descKey)}
        />
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
          <div className="flex-1 overflow-y-auto p-4">
            {aside?.mode === 'run' ? (
              <RunDetailContent run={aside.run} />
            ) : aside?.mode === 'list' ? (
              <BrowseList runs={aside.runs} descKey={aside.descKey} onSelect={openDetail} />
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function BrowseList({
  runs,
  descKey,
  onSelect,
}: {
  runs: Run[];
  descKey: string;
  onSelect: (run: Run) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t(descKey)}</p>
      {runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-2 py-3 text-center text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('overview.column.empty')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs text-brand-600 dark:text-brand-400">
                  {run.repoOwner}/{run.repoName}#{run.issueNumber}
                </span>
                <span className="block truncate text-sm text-gray-700 dark:text-gray-300">{run.issueTitle}</span>
              </span>
              <StatusBadge status={run.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
