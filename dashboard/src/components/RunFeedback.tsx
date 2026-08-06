import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { runs } from '@/api/client';
import { useI18n } from '@/i18n/I18nProvider';

interface RunFeedbackProps {
  runId: string;
}

export default function RunFeedback({ runId }: RunFeedbackProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'submitted'>('idle');

  async function handleSubmit(verdict: 'good' | 'bad_fix') {
    try {
      await runs.feedbackSubmit(runId, verdict);
      setStatus('submitted');
    } catch {
      // Silently fail — feedback is non-critical
    }
  }

  if (status === 'submitted') {
    return <span className="text-xs text-gray-400 dark:text-gray-500">{t('dashboard.feedbackThanks')}</span>;
  }

  return (
    <fieldset className="flex items-center gap-1" aria-label="Run feedback">
      <button
        type="button"
        onClick={() => handleSubmit('good')}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
        aria-label="Helpful"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => handleSubmit('bad_fix')}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
        aria-label="Not helpful"
      >
        <ThumbsDown size={14} />
      </button>
    </fieldset>
  );
}
