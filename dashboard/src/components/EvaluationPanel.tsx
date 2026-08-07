import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import type { FeedbackDelta, ProjectEvaluation, Severity } from '@/utils/evaluation';

export function severityBadge(severity: Severity): string {
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

const PERCENT_ITEMS = new Set(['usage', 'failure-rate', 'pass-rate', 'bug-fix-rate']);

export default function EvaluationPanel({
  evaluation,
  feedback,
  hasFailed,
}: {
  evaluation: ProjectEvaluation;
  feedback: FeedbackDelta[];
  hasFailed: boolean;
}) {
  const { t } = useI18n();
  const feedbackMap = new Map(feedback.map((f) => [f.id, f]));
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('overview.evaluation.title')}</h3>
        <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {t('overview.evaluation.lastRun')}: {new Date(evaluation.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.criteria')}</th>
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.value')}</th>
              <th className="hidden pb-2 pr-4 font-medium sm:table-cell">{t('overview.evaluation.evidence')}</th>
              <th className="pb-2 pr-4 font-medium">{t('overview.evaluation.verdict')}</th>
              <th className="pb-2 font-medium">{t('overview.evaluation.trend')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {evaluation.rubric.map((item) => {
              const delta = feedbackMap.get(item.id);
              return (
                <tr key={item.id}>
                  <td className="py-2 pr-4">
                    <span className="text-gray-900 dark:text-gray-100">{t(item.labelKey)}</span>
                    <span className="ml-2 hidden text-[11px] text-gray-400 md:inline">{item.criteria}</span>
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700 dark:text-gray-300">
                    {item.value === null
                      ? '\u2014'
                      : `${Math.round(item.value * 10) / 10}${PERCENT_ITEMS.has(item.id) ? '%' : ''}`}
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
          {evaluation.score === null ? '\u2014' : `${evaluation.score}/100`}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadge(evaluation.verdict)}`}
        >
          {t(`overview.verdicts.${evaluation.verdict}`)}
        </span>
        {hasFailed && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={12} />
            {t('overview.evaluation.actionHint')}
          </span>
        )}
        {evaluation.actions.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {evaluation.actions.map((action) => (
              <span
                key={action}
                className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300"
              >
                {t(action)}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function TrendCell({ delta }: { delta: FeedbackDelta }) {
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
      {delta.delta === null ? '' : `${improved ? '+' : ''}${Math.round(delta.delta * 10) / 10}`}
      {t(`overview.evaluation.trend${improved ? 'Improved' : 'Regressed'}`)}
    </span>
  );
}
